import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "insta" | "web" | "naver" | "blog";
type Finding = { type: "issue" | "good" | "tip"; text: string };
type ChannelResult = { score: number; status: string; findings: Finding[] };

type InputPayload = {
  hospName?: string;
  specialty?: string;
  urls?: Partial<Record<ChannelKey, string>>;
};

type PageSnapshot = {
  input_url: string;
  ok: boolean;
  status?: number;
  final_url?: string;
  title?: string;
  description?: string;
  h1?: string[];
  headings?: string[];
  image_count?: number;
  image_alt_samples?: string[];
  text_sample?: string;
  error?: string;
};

type InstaPost = {
  url?: string;
  caption?: string;
  likes?: number | null;
  comments?: number | null;
  timestamp?: string;
  type?: string;
  image?: string;
  videoViews?: number | null;
  hashtags?: string[];
  mentions?: string[];
  commentsSample?: string[];
  isCarousel?: boolean;
};

type InstagramSnapshot = {
  input_url: string;
  username?: string;
  ok: boolean;
  source: "apify" | "skipped" | "error";
  actor_ids?: string[];
  profile?: Record<string, unknown> | null;
  profile_items_count?: number;
  general_items_count?: number;
  post_items_count?: number;
  post_count?: number;
  avg_likes?: number | null;
  avg_comments?: number | null;
  engagement_rate?: number | null;
  latest_posts?: InstaPost[];
  errors?: string[];
  error?: string;
};

const CHANNELS = [
  { key: "insta", label: "인스타그램", weight: 35 },
  { key: "web", label: "홈페이지", weight: 35 },
  { key: "naver", label: "네이버 플레이스", weight: 20 },
  { key: "blog", label: "블로그", weight: 10 }
] as const;

const CHANNEL_WEIGHTS: Record<ChannelKey, number> = { insta: 35, web: 35, naver: 20, blog: 10 };
const CHANNEL_LABELS: Record<ChannelKey, string> = { insta: "인스타그램", web: "홈페이지", naver: "네이버 플레이스", blog: "블로그" };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InputPayload;
    const hospName = cleanText(body.hospName || "분석 대상 병원", 80);
    const specialty = cleanText(body.specialty || "", 80);
    const urls = normalizeUrls(body.urls || {});
    const activeChannels = getActiveChannels(urls);

    if (!activeChannels.length) {
      return NextResponse.json({ message: "분석할 URL을 하나 이상 입력해주세요." }, { status: 400 });
    }

    const instagram = await collectInstagram(urls.insta || "");
    const [web, naver, blog] = await Promise.all([collectPage(urls.web || ""), collectPage(urls.naver || ""), collectPage(urls.blog || "")]);
    const collected = { instagram, pages: { web, naver, blog } };
    const result = await analyzeWithAiOrHeuristic({ hospName, specialty, urls, activeChannels, collected });
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "분석 처리 중 오류가 발생했습니다.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

function getActiveChannels(urls: Record<ChannelKey, string>): ChannelKey[] {
  return CHANNELS.map((ch) => ch.key).filter((key) => Boolean(urls[key]));
}

function normalizeUrls(urls: Partial<Record<ChannelKey, string>>): Record<ChannelKey, string> {
  return { insta: normalizeUrl(urls.insta), web: normalizeUrl(urls.web), naver: normalizeUrl(urls.naver), blog: normalizeUrl(urls.blog) };
}

function normalizeUrl(value?: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("@")) return `https://www.instagram.com/${raw.slice(1)}/`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[A-Za-z0-9._]+$/.test(raw)) return `https://www.instagram.com/${raw}/`;
  return `https://${raw}`;
}

function cleanText(value: string, max = 500): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getMeta(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1], 300);
  }
  return "";
}

function getTagText(html: string, tag: string, maxItems = 8): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && out.length < maxItems) {
    const text = cleanText(stripHtml(match[1]), 120);
    if (text) out.push(text);
  }
  return out;
}

function getImageAltSamples(html: string, maxItems = 8): string[] {
  const out: string[] = [];
  const re = /<img[^>]+alt=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && out.length < maxItems) {
    const text = cleanText(match[1], 120);
    if (text) out.push(text);
  }
  return out;
}

async function collectPage(url: string): Promise<PageSnapshot | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PhotoclinicChannelAnalyzer/1.0; +https://www.photoclinic.kr)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7"
      },
      signal: AbortSignal.timeout(12000)
    });
    const html = await res.text();
    return {
      input_url: url,
      ok: res.ok,
      status: res.status,
      final_url: res.url,
      title: cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " "), 200),
      description: getMeta(html, "description") || getMeta(html, "og:description"),
      h1: getTagText(html, "h1", 4),
      headings: [...getTagText(html, "h2", 6), ...getTagText(html, "h3", 6)].slice(0, 8),
      image_count: (html.match(/<img\b/gi) || []).length,
      image_alt_samples: getImageAltSamples(html, 8),
      text_sample: cleanText(stripHtml(html), 1600)
    };
  } catch (err) {
    return { input_url: url, ok: false, error: err instanceof Error ? err.message : "페이지 수집 실패" };
  }
}

function extractInstagramUsername(input: string): string {
  const cleaned = input.trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("@")) return cleaned.slice(1);
  const m = cleaned.match(/instagram\.com\/([^/?#]+)/i);
  if (m?.[1]) return m[1].replace(/^@/, "");
  if (/^[A-Za-z0-9._]+$/.test(cleaned)) return cleaned;
  return "";
}

async function runApifyActor(actorIdRaw: string, token: string, payload: Record<string, unknown>, timeoutSec = 120) {
  const actorId = actorIdRaw.replace("/", "~");
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutSec}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout((timeoutSec + 10) * 1000)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${actorIdRaw}: ${res.status} ${text.slice(0, 220)}`);
  }
  return (await res.json()) as Array<Record<string, unknown>>;
}

async function collectInstagram(url: string): Promise<InstagramSnapshot | null> {
  if (!url) return null;

  const token = process.env.APIFY_TOKEN;
  const username = extractInstagramUsername(url);
  const limit = Number(process.env.APIFY_INSTAGRAM_LIMIT || 18);
  const generalActor = process.env.APIFY_INSTAGRAM_SCRAPER_ACTOR_ID || process.env.APIFY_INSTAGRAM_ACTOR_ID || "apify/instagram-scraper";
  const postActor = process.env.APIFY_INSTAGRAM_POST_SCRAPER_ACTOR_ID || "apify/instagram-post-scraper";
  const profileActor = process.env.APIFY_INSTAGRAM_PROFILE_SCRAPER_ACTOR_ID || "apify/instagram-profile-scraper";

  if (!token) {
    return { input_url: url, username, ok: false, source: "skipped", error: "APIFY_TOKEN 환경변수가 없어 인스타그램 수집을 건너뛰었습니다." };
  }

  const errors: string[] = [];
  let generalItems: Array<Record<string, unknown>> = [];
  let postItems: Array<Record<string, unknown>> = [];
  let profileItems: Array<Record<string, unknown>> = [];

  try {
    generalItems = await runApifyActor(generalActor, token, { directUrls: [url], resultsType: "posts", resultsLimit: limit, addParentData: true, searchType: "user" });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Instagram Scraper 실패");
  }

  if (username) {
    try {
      postItems = await runApifyActor(postActor, token, { usernames: [username], resultsLimit: limit });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Instagram Post Scraper 실패");
    }

    try {
      profileItems = await runApifyActor(profileActor, token, { usernames: [username] }, 90);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Instagram Profile Scraper 실패");
    }
  }

  const profile = normalizeProfile(profileItems[0] || findProfileFromPosts([...postItems, ...generalItems]));
  const posts = normalizePosts([...postItems, ...generalItems], limit);
  const likeValues = posts.map((p) => p.likes).filter((v): v is number => typeof v === "number");
  const commentValues = posts.map((p) => p.comments).filter((v): v is number => typeof v === "number");
  const avgLikes = average(likeValues);
  const avgComments = average(commentValues);
  const followers = asNumber(profile?.followersCount ?? profile?.followers ?? profile?.followers_count);
  const engagementRate = followers && avgLikes !== null ? Math.round((((avgLikes || 0) + (avgComments || 0)) / followers) * 10000) / 100 : null;

  return {
    input_url: url,
    username,
    ok: posts.length > 0 || Boolean(profile),
    source: posts.length > 0 || profile ? "apify" : "error",
    actor_ids: [generalActor, postActor, profileActor],
    profile,
    profile_items_count: profileItems.length,
    general_items_count: generalItems.length,
    post_items_count: postItems.length,
    post_count: posts.length,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    engagement_rate: engagementRate,
    latest_posts: posts,
    errors,
    error: errors.length && !posts.length && !profile ? errors.join(" / ") : undefined
  };
}

function findProfileFromPosts(items: Array<Record<string, unknown>>) {
  for (const item of items) {
    const owner = item.owner || item.ownerData || item.profile || item.user || item.author;
    if (owner && typeof owner === "object") return owner as Record<string, unknown>;
  }
  return null;
}

function normalizeProfile(item: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!item) return null;
  return {
    username: asString(item.username) || asString(item.userName) || asString(item.ownerUsername),
    fullName: asString(item.fullName) || asString(item.full_name) || asString(item.name),
    biography: cleanText(asString(item.biography) || asString(item.bio) || asString(item.description), 800),
    followersCount: asNumber(item.followersCount ?? item.followers ?? item.followers_count),
    followsCount: asNumber(item.followsCount ?? item.followingCount ?? item.following),
    postsCount: asNumber(item.postsCount ?? item.posts_count ?? item.mediaCount),
    externalUrl: asString(item.externalUrl) || asString(item.external_url) || asString(item.website),
    profilePicUrl: asString(item.profilePicUrl) || asString(item.profile_pic_url),
    verified: Boolean(item.verified ?? item.isVerified),
    businessCategoryName: asString(item.businessCategoryName) || asString(item.categoryName)
  };
}

function normalizePosts(items: Array<Record<string, unknown>>, limit: number): InstaPost[] {
  const map = new Map<string, InstaPost>();
  for (const item of items) {
    const caption = cleanText(asString(item.caption) || asString(item.firstComment) || asString(item.description) || "", 1000);
    const shortcode = asString(item.shortCode) || asString(item.shortcode) || asString(item.code);
    const url = asString(item.url) || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : "");
    const key = url || shortcode || caption.slice(0, 80);
    if (!key || map.has(key)) continue;
    const type = asString(item.type) || asString(item.productType) || asString(item.mediaType) || "";
    const childPosts = Array.isArray(item.childPosts) ? item.childPosts : Array.isArray(item.children) ? item.children : [];
    const post: InstaPost = {
      url,
      caption,
      likes: asNumber(item.likesCount ?? item.likes ?? item.likeCount),
      comments: asNumber(item.commentsCount ?? item.comments ?? item.commentCount),
      timestamp: asString(item.timestamp) || asString(item.takenAt) || asString(item.createdAt) || "",
      type,
      image: asString(item.displayUrl) || asString(item.imageUrl) || asString(item.thumbnailUrl) || asString(item.image),
      videoViews: asNumber(item.videoViewCount ?? item.videoPlayCount ?? item.videoViews ?? item.viewsCount),
      hashtags: normalizeStringArray(item.hashtags).concat(extractHashtags(caption)).filter(uniqueFilter),
      mentions: normalizeStringArray(item.mentions).concat(extractMentions(caption)).filter(uniqueFilter),
      commentsSample: normalizeComments(item.latestComments || item.comments || item.topComments),
      isCarousel: childPosts.length > 1 || /sidecar|carousel/i.test(type)
    };
    map.set(key, post);
  }
  return Array.from(map.values())
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
    .slice(0, limit);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.replace(/^#|^@/, "") : "")).filter(Boolean).slice(0, 30);
}
function normalizeComments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : typeof v === "object" && v ? asString((v as Record<string, unknown>).text) || asString((v as Record<string, unknown>).comment) : ""))
    .filter(Boolean)
    .slice(0, 5);
}
function extractHashtags(text: string): string[] {
  return Array.from(text.matchAll(/#([\p{L}\p{N}_]+)/gu)).map((m) => m[1]);
}
function extractMentions(text: string): string[] {
  return Array.from(text.matchAll(/@([A-Za-z0-9._]+)/g)).map((m) => m[1]);
}
function uniqueFilter<T>(value: T, index: number, arr: T[]) {
  return arr.indexOf(value) === index;
}

async function analyzeWithAiOrHeuristic(args: {
  hospName: string;
  specialty: string;
  urls: Record<ChannelKey, string>;
  activeChannels: ChannelKey[];
  collected: { instagram: InstagramSnapshot | null; pages: Record<"web" | "naver" | "blog", PageSnapshot | null> };
}) {
  const base = buildHeuristicResult(args, "포토클리닉 자체 로직으로 1차 진단했습니다.");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return base;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 2600,
        temperature: 0.2,
        messages: [{ role: "user", content: buildPrompt(args, base) }]
      }),
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) return { ...base, data_note: `${base.data_note} · AI 문장 보정 실패: ${res.status}` };
    const data = await res.json();
    const txt = Array.isArray(data.content) ? data.content.map((b: { text?: string }) => b.text || "").join("") : "";
    const parsed = parseJson(txt) as any;
    if (!parsed) return base;
    return mergeAiResult(base, parsed);
  } catch {
    return base;
  }
}

function buildPrompt(args: any, base: any) {
  return `당신은 포토클리닉 병원 인스타그램/채널 브랜딩 컨설턴트입니다. 아래 실제 수집 데이터와 자체 점수 결과를 바탕으로 문장만 더 설득력 있게 다듬으세요. 숫자, 원점수, 입력 채널 범위는 유지하세요. 추정하지 말고 데이터 부족은 데이터 부족이라고 쓰세요. JSON만 반환하세요.

병원명: ${args.hospName}
진료과목: ${args.specialty || "미입력"}
입력 채널: ${args.activeChannels.map((key: ChannelKey) => CHANNEL_LABELS[key]).join(", ")}
실제 수집 데이터: ${JSON.stringify(args.collected).slice(0, 14000)}
자체 분석 결과: ${JSON.stringify(base).slice(0, 12000)}

반환 형식:
{
  "overall_summary":"3문장 이내",
  "photo_opportunity":"촬영 개선 핵심 1문장",
  "insta_deep_report":{"executive_summary":"2문장","medical_branding_comment":"2문장","next_actions":["...","...","..."]},
  "package_recommendation":{"name":"추천 촬영 구성명","reason":"추천 이유 1문장","items":["...","...","..."]}
}`;
}

function parseJson(txt: string): unknown | null {
  const s = txt.indexOf("{");
  const e = txt.lastIndexOf("}");
  if (s < 0 || e < 0 || e <= s) return null;
  try {
    return JSON.parse(txt.slice(s, e + 1));
  } catch {
    return null;
  }
}

function mergeAiResult(base: any, ai: any) {
  return {
    ...base,
    overall_summary: cleanText(String(ai.overall_summary || base.overall_summary), 700),
    photo_opportunity: cleanText(String(ai.photo_opportunity || base.photo_opportunity), 400),
    insta_deep_report: {
      ...base.insta_deep_report,
      executive_summary: cleanText(String(ai.insta_deep_report?.executive_summary || base.insta_deep_report?.executive_summary || ""), 500),
      medical_branding_comment: cleanText(String(ai.insta_deep_report?.medical_branding_comment || base.insta_deep_report?.medical_branding_comment || ""), 500),
      next_actions: Array.isArray(ai.insta_deep_report?.next_actions) ? ai.insta_deep_report.next_actions.slice(0, 5).map((v: unknown) => String(v)) : base.insta_deep_report?.next_actions
    },
    package_recommendation: ai.package_recommendation || base.package_recommendation,
    data_note: `${base.data_note} · AI 문장 보정 적용`
  };
}

function buildHeuristicResult(args: {
  hospName: string;
  specialty: string;
  urls: Record<ChannelKey, string>;
  activeChannels: ChannelKey[];
  collected: { instagram: InstagramSnapshot | null; pages: Record<"web" | "naver" | "blog", PageSnapshot | null> };
}, note: string) {
  const instaDeep = buildInstagramDeepReport(args.collected.instagram);
  const insta = scoreInstagram(args.collected.instagram, Boolean(args.urls.insta), instaDeep);
  const web = scorePage(args.collected.pages.web, Boolean(args.urls.web), 35, "홈페이지");
  const naver = scorePage(args.collected.pages.naver, Boolean(args.urls.naver), 20, "네이버 플레이스");
  const blog = scorePage(args.collected.pages.blog, Boolean(args.urls.blog), 10, "블로그");

  const base = { overall_score: 0, overall_summary: "", photo_opportunity: "", channels: { insta, web, naver, blog } };
  const result = enrichResult(base, args, `${note} ${buildDataNote(args.collected)}`);
  const overall = result.overall_score;
  result.overall_summary =
    overall >= 70
      ? "입력된 채널은 기본 운영 상태가 안정적입니다. 다만 병원 선택 전 신뢰를 만드는 의료진·공간·상담 동선 이미지가 더 선명해지면 상담 전환력이 좋아질 수 있습니다."
      : overall >= 45
        ? "입력된 채널에서 운영 흔적은 보이지만, 이미지 일관성과 의료진 신뢰 요소는 추가 정리가 필요합니다. 전문 촬영 자산을 기준으로 채널 대표 이미지를 통일하면 병원 브랜딩 완성도가 올라갑니다."
        : "입력된 채널 기준으로 데이터 또는 신뢰 이미지가 부족합니다. 원장 프로필, 진료 연출, 공간 사진을 먼저 확보해 인스타그램과 주요 채널의 첫인상을 정리하는 것이 우선입니다.";
  result.photo_opportunity = instaDeep.primary_photo_opportunity;
  return {
    ...result,
    insta_deep_report: instaDeep,
    report_sections: buildReportSections(instaDeep, result),
    package_recommendation: buildPackageRecommendation(result.overall_score, args.activeChannels)
  };
}

function buildInstagramDeepReport(data: InstagramSnapshot | null) {
  if (!data?.ok) {
    return {
      executive_summary: "인스타그램 데이터가 충분히 수집되지 않아 상세 분석을 제한적으로 표시합니다.",
      primary_photo_opportunity: "계정 수집이 안정화되면 원장 프로필, 공간, 진료 연출의 부족 여부를 우선 확인하세요.",
      metrics: [],
      content_mix: [],
      top_posts: [],
      hashtag_insights: [],
      caption_keywords: [],
      trust_checklist: ["의료진 얼굴 노출", "공간 실체감", "상담/예약 안내", "진료 과정 설명"],
      conversion_checklist: ["프로필 링크", "상담 CTA", "대표 진료 키워드", "문의 동선"],
      next_actions: ["Apify 토큰과 3개 스크래퍼 설정 확인", "인스타그램 URL 재입력", "게시물 수집 후 리포트 재생성"]
    };
  }

  const posts = data.latest_posts || [];
  const profile = data.profile || {};
  const captions = posts.map((p) => p.caption || "").join(" ");
  const hashCounts = countItems(posts.flatMap((p) => p.hashtags || []));
  const keywords = keywordCounts(captions, ["원장", "의료진", "상담", "예약", "시술", "치료", "공간", "장비", "후기", "전후", "안전", "위생", "피부", "성형", "치과", "통증"]);
  const contentMix = buildContentMix(posts);
  const profileFollowers = asNumber(profile.followersCount) || 0;
  const externalUrl = asString(profile.externalUrl);
  const bio = asString(profile.biography);
  const trustChecklist = [
    `의료진/원장 언급 게시물 ${containsAnyCount(posts, ["원장", "의료진", "대표원장", "doctor", "dr."])}건`,
    `공간/장비 언급 게시물 ${containsAnyCount(posts, ["공간", "내부", "장비", "시설", "위생", "안전"])}건`,
    `상담/예약 CTA 게시물 ${containsAnyCount(posts, ["상담", "예약", "문의", "카카오", "DM", "전화"])}건`,
    bio ? "프로필 소개 문구 확인됨" : "프로필 소개 문구 데이터 부족"
  ];
  const conversionChecklist = [
    externalUrl ? "외부 링크 확인됨" : "프로필 외부 링크 데이터 부족",
    profileFollowers ? `팔로워 ${profileFollowers.toLocaleString("ko-KR")}명 기준 참여율 ${data.engagement_rate ?? "-"}%` : "팔로워 수 데이터 부족",
    `최근 게시물 ${posts.length}건 기준 평균 좋아요 ${data.avg_likes ?? "-"}, 댓글 ${data.avg_comments ?? "-"}`,
    "프로필 방문 후 상담/예약까지 이어지는 문구는 별도 점검 필요"
  ];

  return {
    executive_summary: `Apify 3개 스크래퍼 기준으로 프로필·최근 게시물·게시물 반응 데이터를 통합했습니다. 최근 게시물 ${posts.length}건과 평균 반응을 기준으로 병원 신뢰, 이미지 완성도, 상담 전환 동선을 진단합니다.`,
    medical_branding_comment: "일반 SNS 수치보다 중요한 것은 환자가 병원 선택 전에 느끼는 신뢰입니다. 의료진 얼굴, 실제 공간, 상담 과정, 진료 전문성이 피드에서 반복적으로 보여야 합니다.",
    primary_photo_opportunity: "원장 프로필, 상담 장면, 진료 연출, 병원 공간 이미지를 하나의 톤으로 촬영해 인스타그램 대표 피드와 홈페이지·플레이스에 함께 적용하는 것이 가장 효과적입니다.",
    metrics: [
      { label: "수집 게시물", value: `${posts.length}건` },
      { label: "평균 좋아요", value: data.avg_likes ?? "-" },
      { label: "평균 댓글", value: data.avg_comments ?? "-" },
      { label: "참여율", value: data.engagement_rate !== null && data.engagement_rate !== undefined ? `${data.engagement_rate}%` : "-" },
      { label: "팔로워", value: profileFollowers ? profileFollowers.toLocaleString("ko-KR") : "-" },
      { label: "외부 링크", value: externalUrl ? "있음" : "확인 필요" }
    ],
    content_mix: contentMix,
    top_posts: posts
      .slice()
      .sort((a, b) => (b.likes || 0) + (b.comments || 0) * 3 - ((a.likes || 0) + (a.comments || 0) * 3))
      .slice(0, 5)
      .map((p) => ({ caption: cleanText(p.caption || "캡션 없음", 90), likes: p.likes, comments: p.comments, type: classifyPostType(p), url: p.url })),
    hashtag_insights: Object.entries(hashCounts).slice(0, 12).map(([tag, count]) => ({ tag, count })),
    caption_keywords: keywords,
    trust_checklist: trustChecklist,
    conversion_checklist: conversionChecklist,
    next_actions: [
      "상단 고정 게시물에 원장/대표 진료/상담 동선을 배치하세요.",
      "카드뉴스만 반복하지 말고 실제 의료진·공간·장비 사진을 일정 비율 이상 섞으세요.",
      "좋아요가 높은 게시물의 주제와 촬영 톤을 기준으로 다음 촬영 콘셉트를 정리하세요.",
      "프로필 링크와 게시물 말미 CTA를 상담 예약 중심으로 통일하세요."
    ]
  };
}

function buildContentMix(posts: InstaPost[]) {
  const total = posts.length || 1;
  const buckets = [
    { label: "릴스/영상", count: posts.filter((p) => /video|reel/i.test(p.type || "") || typeof p.videoViews === "number").length },
    { label: "캐러셀", count: posts.filter((p) => p.isCarousel).length },
    { label: "의료진/원장 언급", count: containsAnyCount(posts, ["원장", "의료진", "대표원장", "doctor", "dr."]) },
    { label: "공간/장비 언급", count: containsAnyCount(posts, ["공간", "내부", "장비", "시설", "위생", "안전"]) },
    { label: "상담/예약 CTA", count: containsAnyCount(posts, ["상담", "예약", "문의", "카카오", "DM", "전화"]) }
  ];
  return buckets.map((b) => ({ ...b, ratio: Math.round((b.count / total) * 100) }));
}

function classifyPostType(post: InstaPost) {
  if (post.isCarousel) return "캐러셀";
  if (/video|reel/i.test(post.type || "") || typeof post.videoViews === "number") return "릴스/영상";
  return "이미지";
}

function containsAnyCount(posts: InstaPost[], words: string[]) {
  return posts.filter((p) => words.some((w) => (p.caption || "").toLowerCase().includes(w.toLowerCase()))).length;
}

function countItems(items: string[]) {
  const counts: Record<string, number> = {};
  for (const raw of items) {
    const item = raw.replace(/^#/, "").trim();
    if (!item) continue;
    counts[item] = (counts[item] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function keywordCounts(text: string, words: string[]) {
  return words
    .map((word) => ({ keyword: word, count: (text.match(new RegExp(word, "gi")) || []).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function scoreInstagram(data: InstagramSnapshot | null, hadUrl: boolean, deep: any): ChannelResult {
  if (!hadUrl) return { score: 0, status: "미입력", findings: [{ type: "issue", text: "인스타그램 URL이 입력되지 않아 분석에서 제외했습니다." }] };
  if (!data?.ok) return { score: 8, status: "데이터 부족", findings: [{ type: "issue", text: data?.error || "인스타그램 수집에 실패했습니다." }, { type: "tip", text: "Apify 3개 스크래퍼 설정을 확인하면 상세 리포트가 생성됩니다." }] };

  const posts = data.latest_posts || [];
  const profile = data.profile || {};
  const followers = asNumber((profile as any).followersCount) || 0;
  const engagementRate = typeof data.engagement_rate === "number" ? data.engagement_rate : null;
  const ctaCount = containsAnyCount(posts, ["상담", "예약", "문의", "카카오", "DM", "전화", "링크", "프로필"]);
  const doctorCount = containsAnyCount(posts, ["원장", "의료진", "대표원장", "doctor", "dr.", "전문의"]);
  const spaceCount = containsAnyCount(posts, ["공간", "내부", "장비", "시설", "위생", "안전", "프라이빗"]);
  const reelCount = posts.filter((p) => /video|reel/i.test(p.type || "") || typeof p.videoViews === "number").length;
  const carouselCount = posts.filter((p) => p.isCarousel).length;

  // 35점 만점이지만, 현재 버전은 이미지 자체를 눈으로 판독하지 않고 Apify 텍스트/메타데이터 중심으로 판단합니다.
  // 따라서 실제 사진 품질, 원장 얼굴 노출, 공간 실체감까지 확인하기 전에는 28점(=100점 환산 80점)을 상한으로 둡니다.
  const collectionScore = posts.length >= 18 ? 5 : posts.length >= 12 ? 4 : posts.length >= 6 ? 3 : 1;
  const engagementScore = engagementRate === null ? (typeof data.avg_likes === "number" ? 2 : 0) : engagementRate >= 2 ? 4 : engagementRate >= 1 ? 3 : engagementRate >= 0.4 ? 2 : 1;
  const profileScore = (asString((profile as any).biography) ? 1 : 0) + (asString((profile as any).externalUrl) ? 1 : 0) + (followers > 0 ? 1 : 0) + ((asNumber((profile as any).postsCount) || posts.length) > 0 ? 1 : 0);
  const ctaScore = ctaCount >= 5 ? 4 : ctaCount >= 2 ? 3 : ctaCount >= 1 ? 2 : 0;
  const trustScore = Math.min(6, (doctorCount >= 3 ? 3 : doctorCount >= 1 ? 2 : 0) + (spaceCount >= 3 ? 3 : spaceCount >= 1 ? 2 : 0));
  const varietyScore = Math.min(5, (reelCount > 0 ? 2 : 0) + (carouselCount > 0 ? 2 : 0) + ((deep.hashtag_insights?.length || 0) >= 5 ? 1 : 0));
  const rawScore = collectionScore + engagementScore + profileScore + ctaScore + trustScore + varietyScore;
  const score = Math.min(28, Math.max(10, rawScore));

  return {
    score,
    status: score >= 25 ? "양호" : score >= 18 ? "보통" : "미흡",
    findings: [
      { type: "good", text: `Apify로 최근 게시물 ${posts.length}건과 프로필/반응 데이터를 수집했습니다.` },
      { type: typeof data.avg_likes === "number" ? "good" : "issue", text: `평균 좋아요 ${data.avg_likes ?? "-"}, 평균 댓글 ${data.avg_comments ?? "-"}, 참여율 ${data.engagement_rate ?? "-"}%로 확인됩니다.` },
      { type: ctaCount >= 2 ? "good" : "issue", text: `상담/예약 CTA 언급은 ${ctaCount}건입니다. 상담 전환 문구의 반복성과 명확성을 더 점검해야 합니다.` },
      { type: doctorCount > 0 && spaceCount > 0 ? "good" : "issue", text: `의료진/원장 언급 ${doctorCount}건, 공간/장비 언급 ${spaceCount}건입니다. 실제 이미지 노출 여부는 상세 시각 점검이 필요합니다.` },
      { type: "tip", text: "현재 점수는 Apify 데이터 기준의 잠정 점수입니다. 실제 사진 품질·얼굴 노출·공간 실체감 확인 전에는 만점 처리하지 않습니다." }
    ]
  };
}
function scorePage(data: PageSnapshot | null, hadUrl: boolean, max: number, label: string): ChannelResult {
  if (!hadUrl) return { score: 0, status: "미입력", findings: [{ type: "issue", text: `${label} URL이 입력되지 않아 분석에서 제외했습니다.` }, { type: "tip", text: `${label} URL을 입력하면 사진 노출과 메시지 구조를 함께 확인할 수 있습니다.` }] };
  if (!data?.ok) return { score: Math.max(2, Math.round(max * 0.2)), status: "수집 실패", findings: [{ type: "issue", text: data?.error || `${label} 페이지를 읽지 못했습니다.` }, { type: "tip", text: "접근 차단, 비공개, 로그인 필요 여부를 확인해주세요." }] };
  const hasTitle = Boolean(data.title);
  const hasDesc = Boolean(data.description);
  const imageScore = Math.min(3, Math.floor((data.image_count || 0) / 5));
  const textScore = data.text_sample && data.text_sample.length > 300 ? 2 : 0;
  const raw = (hasTitle ? 3 : 1) + (hasDesc ? 2 : 0) + imageScore + textScore;
  const score = Math.min(max, Math.round((raw / 10) * max));
  return {
    score,
    status: score / max >= 0.7 ? "양호" : score / max >= 0.4 ? "보통" : "미흡",
    findings: [
      { type: hasTitle ? "good" : "issue", text: hasTitle ? `${label} 제목 정보를 확인했습니다: ${cleanText(data.title || "", 80)}` : `${label} 제목 정보가 명확하지 않습니다.` },
      { type: (data.image_count || 0) > 0 ? "good" : "issue", text: `${label}에서 이미지 태그 ${data.image_count || 0}개를 확인했습니다.` },
      { type: hasDesc ? "good" : "issue", text: hasDesc ? "메타 설명이 있어 기본 메시지 구조를 확인할 수 있습니다." : "메타 설명이 부족해 검색/공유 시 메시지가 약할 수 있습니다." },
      { type: "tip", text: "전문 촬영 사진의 실제 노출 위치와 원장·공간 이미지 비율은 추가 시각 점검이 필요합니다." }
    ]
  };
}

function enrichResult(base: any, args: any, note: string) {
  const possiblePoints = args.activeChannels.reduce((sum: number, key: ChannelKey) => sum + CHANNEL_WEIGHTS[key], 0);
  const rawTotal = args.activeChannels.reduce((sum: number, key: ChannelKey) => sum + (base.channels[key]?.score || 0), 0);
  const normalizedOverall = possiblePoints > 0 ? Math.round((rawTotal / possiblePoints) * 100) : 0;
  const coverageSummary = args.activeChannels.length === 1 && args.activeChannels[0] === "insta" ? "인스타그램 단독 분석" : `${args.activeChannels.map((key: ChannelKey) => CHANNEL_LABELS[key]).join(" · ")} 기준 종합 분석`;
  return { ...base, overall_score: normalizedOverall, analyzed_channels: args.activeChannels, possible_points: possiblePoints, raw_total_score: rawTotal, analysis_mode: args.activeChannels.length === 1 && args.activeChannels[0] === "insta" ? "instagram_only" : "channel_mix", coverage_summary: coverageSummary, data_note: note, data_sources: compactSources(args.collected), instagram_metrics: args.collected.instagram ? { ok: args.collected.instagram.ok, source: args.collected.instagram.source, post_count: args.collected.instagram.post_count, avg_likes: args.collected.instagram.avg_likes, avg_comments: args.collected.instagram.avg_comments, engagement_rate: args.collected.instagram.engagement_rate, error: args.collected.instagram.error } : null };
}

function buildReportSections(instaDeep: any, result: any) {
  return [
    { title: "Reading Guide", items: ["일반 SNS 수치가 아니라 병원 선택 전 신뢰를 만드는 요소로 재해석합니다.", "의료진·공간·전문성의 실체가 보이는지 확인합니다.", "프로필 방문 이후 상담/예약으로 이어지는지 확인합니다."] },
    { title: "Instagram Deep Diagnosis", items: [instaDeep.executive_summary, instaDeep.medical_branding_comment, ...(instaDeep.next_actions || [])] },
    { title: "Channel Score Summary", items: Object.entries(result.channels).map(([key, value]: any) => `${CHANNEL_LABELS[key as ChannelKey]} ${value.score}/${CHANNEL_WEIGHTS[key as ChannelKey]}점 · ${value.status}`) }
  ];
}

function buildPackageRecommendation(score: number, activeChannels: ChannelKey[]) {
  if (score < 45) return { name: "브랜드 기본 신뢰 회복 촬영", reason: "채널의 첫인상을 만드는 기본 사진 자산부터 정리해야 합니다.", items: ["원장 프로필", "공간 대표컷", "상담 장면", "진료 연출컷"] };
  if (activeChannels.length >= 3) return { name: "4채널 통합 브랜딩 촬영", reason: "여러 채널에 같은 톤의 사진 자산을 배포할 수 있는 구성이 필요합니다.", items: ["원장/의료진 프로필", "진료 연출", "공간/장비", "SNS 세로형 컷", "네이버 플레이스 대표사진"] };
  return { name: "인스타그램 피드 리뉴얼 촬영", reason: "현재 인스타그램 운영 데이터를 기반으로 반응 좋은 주제를 사진 자산으로 확장하는 구성이 적합합니다.", items: ["대표 원장 프로필", "상담/시술 연출", "공간 무드컷", "릴스 썸네일용 세로컷"] };
}

function buildDataNote(collected: { instagram: InstagramSnapshot | null; pages: Record<"web" | "naver" | "blog", PageSnapshot | null> }) {
  const parts: string[] = [];
  if (collected.instagram) parts.push(collected.instagram.ok ? `인스타그램 ${collected.instagram.post_count || 0}건 수집` : `인스타그램 ${collected.instagram.source}`);
  for (const [key, page] of Object.entries(collected.pages)) if (page) parts.push(`${key} ${page.ok ? `HTTP ${page.status}` : "수집 실패"}`);
  return parts.length ? parts.join(" · ") : "입력 URL 없음";
}

function compactSources(collected: { instagram: InstagramSnapshot | null; pages: Record<"web" | "naver" | "blog", PageSnapshot | null> }) {
  return {
    instagram: collected.instagram ? { ok: collected.instagram.ok, source: collected.instagram.source, actor_ids: collected.instagram.actor_ids, profile_items_count: collected.instagram.profile_items_count, general_items_count: collected.instagram.general_items_count, post_items_count: collected.instagram.post_items_count, post_count: collected.instagram.post_count, error: collected.instagram.error, errors: collected.instagram.errors } : null,
    pages: Object.fromEntries(Object.entries(collected.pages).map(([k, v]) => [k, v ? { ok: v.ok, status: v.status, title: v.title, image_count: v.image_count, error: v.error } : null]))
  };
}
