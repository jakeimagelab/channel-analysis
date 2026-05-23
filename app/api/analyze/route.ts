import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "insta" | "web" | "naver" | "blog";
type FindingType = "issue" | "good" | "tip";
type Finding = { type: FindingType; text: string };
type ChannelResult = { score: number; status: string; findings: Finding[]; detail?: Record<string, unknown> };

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
  image_alt_count?: number;
  image_alt_samples?: string[];
  text_sample?: string;
  text_length?: number;
  has_json_ld?: boolean;
  json_ld_types?: string[];
  has_faq?: boolean;
  has_schema_org?: boolean;
  canonical?: string;
  og_title?: string;
  og_description?: string;
  robots?: string;
  internal_links?: number;
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
  { key: "web",   label: "홈페이지",   weight: 35 },
  { key: "naver", label: "네이버 플레이스", weight: 20 },
  { key: "blog",  label: "블로그",     weight: 10 }
] as const;

const CHANNEL_WEIGHTS: Record<ChannelKey, number> = { insta: 35, web: 35, naver: 20, blog: 10 };
const CHANNEL_LABELS:  Record<ChannelKey, string>  = { insta: "인스타그램", web: "홈페이지", naver: "네이버 플레이스", blog: "블로그" };

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InputPayload;
    const hospName      = cleanText(body.hospName  || "분석 대상 병원", 80);
    const specialty     = cleanText(body.specialty || "", 80);
    const urls          = normalizeUrls(body.urls  || {});
    const activeChannels = getActiveChannels(urls);

    if (!activeChannels.length) {
      return NextResponse.json({ message: "분석할 URL을 하나 이상 입력해주세요." }, { status: 400 });
    }

    const instagram = await collectInstagram(urls.insta || "");
    const [web, naver, blog] = await Promise.all([
      collectPage(urls.web   || ""),
      collectPage(urls.naver || ""),
      collectPage(urls.blog  || "")
    ]);

    const collected = { instagram, pages: { web, naver, blog } };
    const result    = await analyzeWithAiOrHeuristic({ hospName, specialty, urls, activeChannels, collected });
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "분석 처리 중 오류가 발생했습니다.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// URL HELPERS
// ─────────────────────────────────────────────
function getActiveChannels(urls: Record<ChannelKey, string>): ChannelKey[] {
  return CHANNELS.map(ch => ch.key).filter(key => Boolean(urls[key]));
}

function normalizeUrls(urls: Partial<Record<ChannelKey, string>>): Record<ChannelKey, string> {
  return {
    insta: normalizeUrl(urls.insta),
    web:   normalizeUrl(urls.web),
    naver: normalizeUrl(urls.naver),
    blog:  normalizeUrl(urls.blog)
  };
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

// ─────────────────────────────────────────────
// HTML UTILS
// ─────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function getMeta(html: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pats = [
    new RegExp(`<meta[^>]+name=["']${esc}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${esc}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${esc}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${esc}["'][^>]*>`, "i")
  ];
  for (const p of pats) { const m = html.match(p); if (m?.[1]) return cleanText(m[1], 300); }
  return "";
}

function getTagText(html: string, tag: string, maxItems = 8): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < maxItems) {
    const t = cleanText(stripHtml(m[1]), 120);
    if (t) out.push(t);
  }
  return out;
}

function getImageAltSamples(html: string, maxItems = 8): string[] {
  const out: string[] = [];
  const re = /<img[^>]+alt=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < maxItems) {
    const t = cleanText(m[1], 120);
    if (t) out.push(t);
  }
  return out;
}

// ─────────────────────────────────────────────
// PAGE COLLECTOR — 홈페이지/네이버/블로그 공통
// ─────────────────────────────────────────────
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
    const imgTags     = (html.match(/<img\b/gi) || []).length;
    const imgAltTags  = (html.match(/<img[^>]+alt=["'][^"']+["'][^>]*>/gi) || []).length;
    const jsonLdBlocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
      .map(m => { try { return JSON.parse(m[1]); } catch { return null; } })
      .filter(Boolean);
    const jsonLdTypes = jsonLdBlocks.map((b: any) => b["@type"] || "").filter(Boolean);
    const textRaw     = stripHtml(html);

    return {
      input_url:          url,
      ok:                 res.ok,
      status:             res.status,
      final_url:          res.url,
      title:              cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " "), 200),
      description:        getMeta(html, "description") || getMeta(html, "og:description"),
      h1:                 getTagText(html, "h1", 4),
      headings:           [...getTagText(html, "h2", 6), ...getTagText(html, "h3", 6)].slice(0, 10),
      image_count:        imgTags,
      image_alt_count:    imgAltTags,
      image_alt_samples:  getImageAltSamples(html, 8),
      text_sample:        cleanText(textRaw, 2000),
      text_length:        textRaw.length,
      has_json_ld:        jsonLdBlocks.length > 0,
      json_ld_types:      jsonLdTypes,
      has_faq:            /FAQ|자주.*묻|자주.*질문/i.test(html),
      has_schema_org:     html.includes("schema.org"),
      canonical:          getMeta(html, "canonical") || (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || ""),
      og_title:           getMeta(html, "og:title"),
      og_description:     getMeta(html, "og:description"),
      robots:             getMeta(html, "robots"),
      internal_links:     (html.match(/<a\s/gi) || []).length
    };
  } catch (err) {
    return { input_url: url, ok: false, error: err instanceof Error ? err.message : "페이지 수집 실패" };
  }
}

// ─────────────────────────────────────────────
// INSTAGRAM COLLECTOR (Apify)
// ─────────────────────────────────────────────
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
  const actorId  = actorIdRaw.replace("/", "~");
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutSec}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout((timeoutSec + 10) * 1000)
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`${actorIdRaw}: ${res.status} ${text.slice(0, 220)}`); }
  return (await res.json()) as Array<Record<string, unknown>>;
}

async function collectInstagram(url: string): Promise<InstagramSnapshot | null> {
  if (!url) return null;
  const token         = process.env.APIFY_TOKEN;
  const username      = extractInstagramUsername(url);
  const limit         = Number(process.env.APIFY_INSTAGRAM_LIMIT || 18);
  const generalActor  = process.env.APIFY_INSTAGRAM_SCRAPER_ACTOR_ID  || "apify/instagram-scraper";
  const postActor     = process.env.APIFY_INSTAGRAM_POST_SCRAPER_ACTOR_ID || "apify/instagram-post-scraper";
  const profileActor  = process.env.APIFY_INSTAGRAM_PROFILE_SCRAPER_ACTOR_ID || "apify/instagram-profile-scraper";

  if (!token) {
    return { input_url: url, username, ok: false, source: "skipped", error: "APIFY_TOKEN 환경변수가 없어 인스타그램 수집을 건너뛰었습니다." };
  }

  const errors: string[] = [];
  let generalItems: Array<Record<string, unknown>> = [];
  let postItems:    Array<Record<string, unknown>> = [];
  let profileItems: Array<Record<string, unknown>> = [];

  try { generalItems = await runApifyActor(generalActor, token, { directUrls: [url], resultsType: "posts", resultsLimit: limit, addParentData: true, searchType: "user" }); }
  catch (err) { errors.push(err instanceof Error ? err.message : "Instagram Scraper 실패"); }

  if (username) {
    try { postItems = await runApifyActor(postActor, token, { usernames: [username], resultsLimit: limit }); }
    catch (err) { errors.push(err instanceof Error ? err.message : "Instagram Post Scraper 실패"); }
    try { profileItems = await runApifyActor(profileActor, token, { usernames: [username] }, 90); }
    catch (err) { errors.push(err instanceof Error ? err.message : "Instagram Profile Scraper 실패"); }
  }

  const profile    = normalizeProfile(profileItems[0] || findProfileFromPosts([...postItems, ...generalItems]));
  const posts      = normalizePosts([...postItems, ...generalItems], limit);
  const likeVals   = posts.map(p => p.likes).filter((v): v is number => typeof v === "number");
  const cmtVals    = posts.map(p => p.comments).filter((v): v is number => typeof v === "number");
  const avgLikes   = average(likeVals);
  const avgCmts    = average(cmtVals);
  const followers  = asNumber(profile?.followersCount ?? profile?.followers ?? profile?.followers_count);
  const engRate    = followers && avgLikes !== null ? Math.round((((avgLikes||0)+(avgCmts||0))/followers)*10000)/100 : null;

  return {
    input_url: url, username, ok: posts.length > 0 || Boolean(profile),
    source: posts.length > 0 || profile ? "apify" : "error",
    actor_ids: [generalActor, postActor, profileActor],
    profile, profile_items_count: profileItems.length, general_items_count: generalItems.length,
    post_items_count: postItems.length, post_count: posts.length,
    avg_likes: avgLikes, avg_comments: avgCmts, engagement_rate: engRate,
    latest_posts: posts, errors,
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
    username:             asString(item.username)     || asString(item.userName) || asString(item.ownerUsername),
    fullName:             asString(item.fullName)     || asString(item.full_name) || asString(item.name),
    biography:            cleanText(asString(item.biography) || asString(item.bio) || asString(item.description), 800),
    followersCount:       asNumber(item.followersCount ?? item.followers ?? item.followers_count),
    followsCount:         asNumber(item.followsCount  ?? item.followingCount ?? item.following),
    postsCount:           asNumber(item.postsCount    ?? item.posts_count ?? item.mediaCount),
    externalUrl:          asString(item.externalUrl)  || asString(item.external_url) || asString(item.website),
    profilePicUrl:        asString(item.profilePicUrl) || asString(item.profile_pic_url),
    verified:             Boolean(item.verified ?? item.isVerified),
    businessCategoryName: asString(item.businessCategoryName) || asString(item.categoryName)
  };
}

function normalizePosts(items: Array<Record<string, unknown>>, limit: number): InstaPost[] {
  const map = new Map<string, InstaPost>();
  for (const item of items) {
    const caption   = cleanText(asString(item.caption)||asString(item.firstComment)||asString(item.description)||"", 1000);
    const shortcode = asString(item.shortCode)||asString(item.shortcode)||asString(item.code);
    const url       = asString(item.url)||(shortcode ? `https://www.instagram.com/p/${shortcode}/` : "");
    const key       = url||shortcode||caption.slice(0,80);
    if (!key || map.has(key)) continue;
    const type      = asString(item.type)||asString(item.productType)||asString(item.mediaType)||"";
    const childPosts = Array.isArray(item.childPosts)?item.childPosts:Array.isArray(item.children)?item.children:[];
    map.set(key, {
      url, caption,
      likes:         asNumber(item.likesCount   ?? item.likes    ?? item.likeCount),
      comments:      asNumber(item.commentsCount ?? item.comments ?? item.commentCount),
      timestamp:     asString(item.timestamp)||asString(item.takenAt)||asString(item.createdAt)||"",
      type, image:   asString(item.displayUrl)||asString(item.imageUrl)||asString(item.thumbnailUrl)||asString(item.image),
      videoViews:    asNumber(item.videoViewCount??item.videoPlayCount??item.videoViews??item.viewsCount),
      hashtags:      normalizeStringArray(item.hashtags).concat(extractHashtags(caption)).filter(uniqueFilter),
      mentions:      normalizeStringArray(item.mentions).concat(extractMentions(caption)).filter(uniqueFilter),
      commentsSample:normalizeComments(item.latestComments||item.comments||item.topComments),
      isCarousel:    childPosts.length > 1 || /sidecar|carousel/i.test(type)
    });
  }
  return Array.from(map.values())
    .sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||"")))
    .slice(0, limit);
}

// ─────────────────────────────────────────────
// ★ SCORING — 인스타그램
//   채점 기준: 5항목 × 7점 = 35점 만점
//   (Apify 데이터 한계로 시각 판독 불가 항목은 캡션/메타 텍스트로 추정)
// ─────────────────────────────────────────────
function scoreInstagram(data: InstagramSnapshot | null, hadUrl: boolean, deep: any): ChannelResult {
  if (!hadUrl) return { score: 0, status: "미입력", findings: [{ type:"issue", text:"인스타그램 URL이 입력되지 않아 분석에서 제외했습니다." }] };
  if (!data?.ok) return { score: 8, status: "데이터 부족", findings: [
    { type:"issue", text: data?.error || "인스타그램 수집에 실패했습니다." },
    { type:"tip",   text: "Apify 3개 스크래퍼 설정을 확인하면 상세 리포트가 생성됩니다." }
  ]};

  const posts     = data.latest_posts || [];
  const profile   = data.profile      || {};
  const followers = asNumber((profile as any).followersCount) || 0;
  const engRate   = typeof data.engagement_rate === "number" ? data.engagement_rate : null;
  const reelCount = posts.filter(p => /video|reel/i.test(p.type||"") || typeof p.videoViews==="number").length;
  const carouselCount = posts.filter(p => p.isCarousel).length;
  const doctorCount   = containsAnyCount(posts, ["원장","의료진","대표원장","doctor","dr.","전문의"]);
  const spaceCount    = containsAnyCount(posts, ["공간","내부","장비","시설","위생","안전","프라이빗"]);
  const ctaCount      = containsAnyCount(posts, ["상담","예약","문의","카카오","DM","전화","링크","프로필"]);
  const hashCount     = (deep?.hashtag_insights?.length || 0);
  const bioExists     = Boolean(asString((profile as any).biography));
  const externalUrl   = Boolean(asString((profile as any).externalUrl));
  const postFreq      = posts.length;

  // ① 피드 톤&매너 — 해시태그 일관성 + 릴스/캐러셀 다양성으로 추정 (7점)
  const toneScore = (() => {
    let s = 0;
    if (hashCount >= 8)  s += 3; else if (hashCount >= 4) s += 2; else if (hashCount >= 1) s += 1;
    if (reelCount > 0 && carouselCount > 0) s += 2; else if (reelCount > 0 || carouselCount > 0) s += 1;
    if (postFreq >= 18) s += 2; else if (postFreq >= 10) s += 1;
    return Math.min(7, s);
  })();

  // ② 전문 사진 비율 — 릴스/캐러셀 비율 + 영상 조회수로 추정 (7점)
  const qualityScore = (() => {
    const reelRatio = postFreq > 0 ? reelCount / postFreq : 0;
    const carRatio  = postFreq > 0 ? carouselCount / postFreq : 0;
    let s = 0;
    if (reelRatio  >= 0.3) s += 3; else if (reelRatio  >= 0.1) s += 2; else if (reelRatio > 0) s += 1;
    if (carRatio   >= 0.3) s += 2; else if (carRatio   >= 0.1) s += 1;
    if (typeof data.avg_likes === "number" && data.avg_likes >= 50) s += 2; else if (typeof data.avg_likes === "number" && data.avg_likes >= 20) s += 1;
    return Math.min(7, s);
  })();

  // ③ 원장·스탭 등장 — 캡션 키워드 기반 (7점)
  const peopleScore = (() => {
    if (doctorCount >= 5) return 7;
    if (doctorCount >= 3) return 5;
    if (doctorCount >= 1) return 3;
    return 0;
  })();

  // ④ 공간·시술 사진 — 캡션 키워드 기반 (7점)
  const spaceScore = (() => {
    if (spaceCount >= 5 && ctaCount >= 3) return 7;
    if (spaceCount >= 3 || (spaceCount >= 1 && ctaCount >= 1)) return 5;
    if (spaceCount >= 1 || ctaCount >= 1) return 3;
    return 0;
  })();

  // ⑤ 참여율·최신성 — 팔로워 대비 참여율 + 게시 빈도 (7점)
  const engScore = (() => {
    let s = 0;
    if      (engRate !== null && engRate >= 3)   s += 4;
    else if (engRate !== null && engRate >= 1.5) s += 3;
    else if (engRate !== null && engRate >= 0.5) s += 2;
    else if (typeof data.avg_likes === "number") s += 1;
    if (bioExists)    s += 1;
    if (externalUrl)  s += 1;
    if (postFreq >= 15) s += 1;
    return Math.min(7, s);
  })();

  const score = toneScore + qualityScore + peopleScore + spaceScore + engScore;
  const findings: Finding[] = [
    { type: engRate !== null && engRate >= 1.5 ? "good" : "issue",
      text: `참여율 ${engRate ?? "-"}% · 평균 좋아요 ${data.avg_likes ?? "-"} · 팔로워 ${followers ? followers.toLocaleString("ko-KR") : "-"}명` },
    { type: doctorCount >= 3 ? "good" : "issue",
      text: `원장·의료진 언급 ${doctorCount}건 — ${doctorCount < 2 ? "의료진 등장 콘텐츠를 늘리면 신뢰도 상승" : "의료진 노출 양호"}` },
    { type: spaceCount >= 3 ? "good" : "issue",
      text: `공간·시술 언급 ${spaceCount}건 · 상담 CTA ${ctaCount}건 — ${spaceCount < 2 ? "공간 실체감 콘텐츠 보강 필요" : "공간 콘텐츠 양호"}` },
    { type: reelCount > 0 ? "good" : "tip",
      text: `릴스 ${reelCount}건 · 캐러셀 ${carouselCount}건 · 해시태그 그룹 ${hashCount}종 — ${reelCount === 0 ? "릴스 도달 확장을 위해 릴스 추가 권장" : "콘텐츠 포맷 다양"}` },
    { type: "tip",
      text: "사진 화질·색감·톤은 Apify 텍스트 데이터로 판독 불가 — 포토클리닉 시각 점검으로 최종 확인 필요" }
  ];

  return {
    score: Math.min(35, Math.max(5, score)),
    status: score >= 28 ? "양호" : score >= 18 ? "보통" : "미흡",
    findings,
    detail: { toneScore, qualityScore, peopleScore, spaceScore, engScore }
  };
}

// ─────────────────────────────────────────────
// ★ SCORING — 홈페이지
//   채점 기준: 5항목 × 7점 = 35점 만점
//   + SEO / AI검색 최적화 별도 진단
// ─────────────────────────────────────────────
function scoreWeb(data: PageSnapshot | null, hadUrl: boolean): ChannelResult {
  if (!hadUrl) return { score: 0, status: "미입력", findings: [{ type:"issue", text:"홈페이지 URL이 입력되지 않아 분석에서 제외했습니다." }, { type:"tip", text:"홈페이지 URL을 입력하면 SEO·AI검색 최적화까지 진단합니다." }] };
  if (!data?.ok) return { score: 7, status: "수집 실패", findings: [{ type:"issue", text: data?.error || "홈페이지 페이지를 읽지 못했습니다." }, { type:"tip", text:"접근 차단·비공개·로그인 필요 여부를 확인해주세요." }] };

  const title       = data.title       || "";
  const desc        = data.description || "";
  const h1Count     = (data.h1 || []).length;
  const headings    = (data.headings   || []).length;
  const imgCount    = data.image_count || 0;
  const altCount    = data.image_alt_count || 0;
  const textLen     = data.text_length || 0;
  const hasJsonLd   = data.has_json_ld || false;
  const jsonTypes   = data.json_ld_types || [];
  const hasFaq      = data.has_faq || false;
  const hasSchema   = data.has_schema_org || false;
  const hasOg       = Boolean(data.og_title);
  const descLen     = desc.length;
  const sample      = (data.text_sample || "").toLowerCase();
  const hasDoctorKeyword = /원장|의료진|대표원장|전문의|doctor|경력|약력/.test(sample);
  const hasTreatmentInfo = /시술|진료|치료|수술|상담|예약/.test(sample);
  const altRatio    = imgCount > 0 ? altCount / imgCount : 0;

  // ① 메시지·사진 일치 (콘텐츠 관련성) (7점)
  const messageScore = (() => {
    let s = 0;
    if (hasDoctorKeyword)   s += 2;
    if (hasTreatmentInfo)   s += 2;
    if (h1Count >= 1)       s += 2;
    if (headings >= 3)      s += 1;
    return Math.min(7, s);
  })();

  // ② SEO 기본 설정 (7점)
  const seoScore = (() => {
    let s = 0;
    if (title.length >= 10 && title.length <= 70) s += 2; else if (title.length > 0) s += 1;
    if (descLen >= 50 && descLen <= 160) s += 2; else if (descLen > 0) s += 1;
    if (altRatio >= 0.8) s += 2; else if (altRatio >= 0.4) s += 1;
    if (hasOg) s += 1;
    return Math.min(7, s);
  })();

  // ③ AI검색 대응 구조 (7점)
  const aiSeoScore = (() => {
    let s = 0;
    if (hasJsonLd) {
      s += 2;
      if (jsonTypes.some(t => /MedicalBusiness|Physician|LocalBusiness|Hospital/i.test(t))) s += 2;
      else s += 1;
    }
    if (hasFaq)    s += 2;
    if (hasSchema) s += 1;
    return Math.min(7, s);
  })();

  // ④ 이미지 품질 (이미지 수·alt 비율로 추정) (7점)
  const imageScore = (() => {
    let s = 0;
    if (imgCount >= 15) s += 3; else if (imgCount >= 8) s += 2; else if (imgCount >= 3) s += 1;
    if (altRatio >= 0.7) s += 2; else if (altRatio >= 0.4) s += 1;
    if (textLen >= 2000) s += 2; else if (textLen >= 800) s += 1;
    return Math.min(7, s);
  })();

  // ⑤ 원장·공간 콘텐츠 (7점)
  const contentScore = (() => {
    let s = 0;
    if (hasDoctorKeyword)   s += 3;
    if (hasTreatmentInfo)   s += 2;
    if (textLen >= 1500)    s += 2;
    return Math.min(7, s);
  })();

  const score = messageScore + seoScore + aiSeoScore + imageScore + contentScore;

  const findings: Finding[] = [
    { type: title.length >= 10 ? "good" : "issue",
      text: `페이지 제목: "${title.slice(0,50)}" (${title.length}자) — ${title.length < 10 ? "제목이 너무 짧습니다" : title.length > 70 ? "70자 이내 권장" : "적정"}` },
    { type: descLen >= 50 && descLen <= 160 ? "good" : "issue",
      text: `메타 설명: ${descLen}자 — ${descLen === 0 ? "메타 설명 없음, 검색·공유 클릭률 저하" : descLen < 50 ? "설명이 너무 짧습니다" : descLen > 160 ? "160자 이내 권장" : "적정 길이"}` },
    { type: hasJsonLd ? "good" : "issue",
      text: hasJsonLd
        ? `구조화 데이터(JSON-LD) 확인됨 — 타입: ${jsonTypes.join(", ") || "확인 필요"} · AI검색 노출에 유리`
        : "구조화 데이터(JSON-LD) 없음 — MedicalBusiness 스키마 추가 시 AI검색·구글 리치결과 노출 유리" },
    { type: hasFaq ? "good" : "tip",
      text: hasFaq ? "FAQ 섹션 확인됨 — AI 검색(SGE/Perplexity)에서 직접 인용될 가능성 높음" : "FAQ 섹션 없음 — 자주 묻는 진료 질문 섹션 추가 시 AI검색 노출 상승" },
    { type: altRatio >= 0.5 ? "good" : "issue",
      text: `이미지 ${imgCount}개 중 alt 텍스트 ${altCount}개 (${Math.round(altRatio*100)}%) — ${altRatio < 0.5 ? "이미지 alt 태그 보완 필요, SEO·접근성 개선" : "alt 태그 양호"}` },
    { type: hasDoctorKeyword ? "good" : "issue",
      text: hasDoctorKeyword ? "원장·의료진 정보 확인됨 — E-E-A-T 신호 양호" : "원장 소개·경력 정보 부족 — 검색엔진 전문성 신호(E-E-A-T) 추가 필요" }
  ];

  return {
    score: Math.min(35, Math.max(5, score)),
    status: score >= 26 ? "양호" : score >= 16 ? "보통" : "미흡",
    findings,
    detail: { messageScore, seoScore, aiSeoScore, imageScore, contentScore, hasJsonLd, hasFaq, jsonLdTypes: jsonTypes, altRatio: Math.round(altRatio*100) }
  };
}

// ─────────────────────────────────────────────
// ★ SCORING — 네이버 플레이스
//   채점 기준: 4항목 × 5점 = 20점 만점
//   네이버 플레이스 전용 로직 적용
// ─────────────────────────────────────────────
function scoreNaver(data: PageSnapshot | null, hadUrl: boolean): ChannelResult {
  if (!hadUrl) return { score: 0, status: "미입력", findings: [{ type:"issue", text:"네이버 플레이스 URL이 입력되지 않아 분석에서 제외했습니다." }, { type:"tip", text:"플레이스 사진 등록 수·리뷰·의료진 정보를 직접 확인하면 더 정확합니다." }] };
  if (!data?.ok) return { score: 4, status: "수집 실패", findings: [{ type:"issue", text: data?.error || "네이버 플레이스 페이지를 읽지 못했습니다." }, { type:"tip", text:"네이버 플레이스는 로그인·앱 전용 접근 시 수집이 제한될 수 있습니다." }] };

  const title    = data.title  || "";
  const desc     = data.description || "";
  const sample   = (data.text_sample || "").toLowerCase();
  const imgCount = data.image_count || 0;
  const altCount = data.image_alt_count || 0;

  // 네이버 플레이스 특화 키워드 파싱
  const hasHours       = /영업.*시간|운영.*시간|월~|평일|주말|am|pm|\d+:\d+/.test(sample);
  const hasPhone       = /전화|전화번호|tel|\d{2,4}-\d{3,4}-\d{4}/.test(sample);
  const hasAddress     = /서울|경기|부산|인천|대구|광주|대전|주소|위치/.test(sample);
  const hasReview      = /리뷰|후기|별점|평점|방문자|블로그리뷰/.test(sample);
  const hasSave        = /저장|찜|즐겨찾기/.test(sample);
  const hasDoctorInfo  = /원장|의료진|전문의|대표원장/.test(sample);
  const hasMenu        = /진료|시술|메뉴|가격|비용|예약/.test(sample);
  const hasFacility    = /공간|내부|시설|장비|인테리어|깔끔/.test(sample);
  const titleHasClinic = /병원|의원|클리닉|치과|피부|성형|한의/.test(title);

  // ① 대표 사진 품질 (5점) — 이미지 수·alt 기반 추정
  const photoScore = (() => {
    if (imgCount >= 20 && altCount >= 5) return 5;
    if (imgCount >= 10) return 3;
    if (imgCount >= 3)  return 2;
    if (imgCount >= 1)  return 1;
    return 0;
  })();

  // ② 내부 사진 + 시설 정보 (5점)
  const facilityScore = (() => {
    let s = 0;
    if (hasFacility)      s += 2;
    if (imgCount >= 10)   s += 2;
    if (hasSave)          s += 1;
    return Math.min(5, s);
  })();

  // ③ 기본 정보 완성도 — 영업시간·전화·주소·메뉴 (5점)
  const infoScore = (() => {
    let s = 0;
    if (hasHours)   s += 1;
    if (hasPhone)   s += 1;
    if (hasAddress) s += 1;
    if (hasMenu)    s += 1;
    if (titleHasClinic) s += 1;
    return Math.min(5, s);
  })();

  // ④ 리뷰·저장·의료진 — 신뢰 지표 (5점)
  const trustScore = (() => {
    let s = 0;
    if (hasReview)     s += 2;
    if (hasDoctorInfo) s += 2;
    if (hasSave)       s += 1;
    return Math.min(5, s);
  })();

  const score = photoScore + facilityScore + infoScore + trustScore;

  const findings: Finding[] = [
    { type: imgCount >= 10 ? "good" : "issue",
      text: `이미지 태그 ${imgCount}개 확인 — ${imgCount < 5 ? "내부 공간·시설 사진이 부족합니다. 전문 사진 5장+ 등록 권장" : imgCount < 10 ? "사진 추가 등록으로 첫인상 개선 가능" : "사진 등록 양호"}` },
    { type: hasHours && hasPhone ? "good" : "issue",
      text: `기본 정보 — 영업시간 ${hasHours?"✓":"없음"} · 전화번호 ${hasPhone?"✓":"없음"} · 주소 ${hasAddress?"✓":"없음"} · 메뉴/진료 ${hasMenu?"✓":"없음"}` },
    { type: hasReview ? "good" : "tip",
      text: hasReview ? "리뷰·후기 정보 확인됨 — 정기적인 리뷰 관리로 신뢰도 유지 필요" : "리뷰 데이터 확인 불가 — 방문자 리뷰 수집과 블로그 리뷰 연동 권장" },
    { type: hasDoctorInfo ? "good" : "issue",
      text: hasDoctorInfo ? "의료진 정보 확인됨" : "의료진·원장 정보 없음 — 플레이스에 원장 프로필 사진·소개 등록 필요" },
    { type: "tip",
      text: "네이버 플레이스 저장 수·스마트콜 연동·포스트 연결 여부는 앱에서 직접 확인을 권장합니다." }
  ];

  return {
    score: Math.min(20, Math.max(2, score)),
    status: score >= 15 ? "양호" : score >= 8 ? "보통" : "미흡",
    findings,
    detail: { photoScore, facilityScore, infoScore, trustScore, hasHours, hasPhone, hasReview, hasDoctorInfo, imgCount }
  };
}

// ─────────────────────────────────────────────
// ★ SCORING — 블로그
//   채점 기준: 2항목 × 5점 = 10점 만점
//   네이버 블로그 노출 로직 반영
// ─────────────────────────────────────────────
function scoreBlog(data: PageSnapshot | null, hadUrl: boolean): ChannelResult {
  if (!hadUrl) return { score: 0, status: "미입력", findings: [{ type:"issue", text:"블로그 URL이 입력되지 않아 분석에서 제외했습니다." }] };
  if (!data?.ok) return { score: 2, status: "수집 실패", findings: [{ type:"issue", text: data?.error || "블로그 페이지를 읽지 못했습니다." }] };

  const title    = data.title  || "";
  const sample   = (data.text_sample || "").toLowerCase();
  const imgCount = data.image_count  || 0;
  const altCount = data.image_alt_count || 0;
  const textLen  = data.text_length  || 0;
  const headings = (data.headings || []).length;
  const h1Count  = (data.h1 || []).length;

  // 블로그 특화 키워드
  const hasTreatment   = /시술|진료|치료|수술|시술후기|부작용|효과|가격|비용/.test(sample);
  const hasDoctorMention = /원장|전문의|의료진|상담/.test(sample);
  const hasLocalKeyword = /서울|강남|분당|신촌|홍대|강북|마포|구로|위치|지역/.test(sample);
  const hasRealPhoto   = imgCount >= 3 && altCount >= 1;
  const hasCtaKeyword  = /예약|상담|문의|전화|카카오|링크|바로가기/.test(sample);
  const hasBeforeAfter = /전후|비교|결과|개선|효과/.test(sample);

  // ① 사진 품질·글 내용 일치도 (5점)
  const contentScore = (() => {
    let s = 0;
    if (imgCount >= 8)  s += 2; else if (imgCount >= 3) s += 1;
    if (altCount >= 3)  s += 1;
    if (hasTreatment)   s += 1;
    if (hasRealPhoto && hasTreatment) s += 1;
    return Math.min(5, s);
  })();

  // ② 네이버 SEO 최적화·업데이트 빈도 추정 (5점)
  const seoScore = (() => {
    let s = 0;
    // 제목 키워드 밀도
    if (/시술|진료|치료|병원|의원|클리닉/.test(title)) s += 2; else if (title.length > 0) s += 1;
    // 글 길이 (네이버 저품질 기준 800자 이상 권장)
    if (textLen >= 1500) s += 2; else if (textLen >= 800) s += 1;
    // 구조 (소제목)
    if (headings >= 2 || h1Count >= 1) s += 1;
    return Math.min(5, s);
  })();

  const score = contentScore + seoScore;

  const findings: Finding[] = [
    { type: imgCount >= 5 ? "good" : "issue",
      text: `이미지 ${imgCount}개 · alt 태그 ${altCount}개 — ${imgCount < 3 ? "실제 병원 사진 부족, 스톡 이미지 위주로 추정" : "사진 수 양호"}` },
    { type: hasTreatment ? "good" : "issue",
      text: hasTreatment ? "시술·진료 관련 키워드 확인됨 — 실제 치료 내용 중심 작성" : "시술·진료 관련 내용 부족 — 실제 진료 경험 중심 콘텐츠 필요" },
    { type: textLen >= 800 ? "good" : "issue",
      text: `본문 길이 약 ${textLen.toLocaleString("ko-KR")}자 — ${textLen < 800 ? "800자 이상 작성 권장 (네이버 저품질 방지)" : textLen < 1500 ? "양호, 1500자 이상이면 더 좋음" : "충분한 본문 길이"}` },
    { type: hasLocalKeyword ? "good" : "tip",
      text: hasLocalKeyword ? "지역 키워드 확인됨 — 지역 검색 노출에 유리" : "지역 키워드 없음 — 병원 위치 지역명 포함 시 지역 검색 노출 개선" },
    { type: hasCtaKeyword ? "good" : "tip",
      text: hasCtaKeyword ? "예약·상담 CTA 확인됨" : "예약·상담 유도 문구 없음 — 글 말미에 상담 링크·카카오채널 추가 권장" }
  ];

  return {
    score: Math.min(10, Math.max(1, score)),
    status: score >= 8 ? "양호" : score >= 5 ? "보통" : "미흡",
    findings,
    detail: { contentScore, seoScore, imgCount, textLen, hasTreatment, hasLocalKeyword, hasCtaKeyword }
  };
}

// ─────────────────────────────────────────────
// ANALYSIS ORCHESTRATION
// ─────────────────────────────────────────────
async function analyzeWithAiOrHeuristic(args: {
  hospName: string; specialty: string;
  urls: Record<ChannelKey, string>; activeChannels: ChannelKey[];
  collected: { instagram: InstagramSnapshot | null; pages: Record<"web"|"naver"|"blog", PageSnapshot | null> };
}) {
  const base = buildHeuristicResult(args, "포토클리닉 자체 로직으로 1차 진단했습니다.");
  const key  = process.env.ANTHROPIC_API_KEY;
  if (!key) return base;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 2600, temperature: 0.2,
        messages: [{ role: "user", content: buildPrompt(args, base) }]
      }),
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) return { ...base, data_note: `${base.data_note} · AI 문장 보정 실패: ${res.status}` };
    const data   = await res.json();
    const txt    = Array.isArray(data.content) ? data.content.map((b: { text?: string }) => b.text || "").join("") : "";
    const parsed = parseJson(txt) as any;
    if (!parsed) return base;
    return mergeAiResult(base, parsed);
  } catch {
    return base;
  }
}

function buildHeuristicResult(args: {
  hospName: string; specialty: string;
  urls: Record<ChannelKey, string>; activeChannels: ChannelKey[];
  collected: { instagram: InstagramSnapshot | null; pages: Record<"web"|"naver"|"blog", PageSnapshot | null> };
}, note: string) {
  const instaDeep = buildInstagramDeepReport(args.collected.instagram);
  const insta  = scoreInstagram(args.collected.instagram, Boolean(args.urls.insta), instaDeep);
  const web    = scoreWeb  (args.collected.pages.web,   Boolean(args.urls.web));
  const naver  = scoreNaver(args.collected.pages.naver, Boolean(args.urls.naver));
  const blog   = scoreBlog (args.collected.pages.blog,  Boolean(args.urls.blog));

  const base   = { overall_score: 0, overall_summary: "", photo_opportunity: "", channels: { insta, web, naver, blog } };
  const result = enrichResult(base, args, `${note} ${buildDataNote(args.collected)}`);
  const overall = result.overall_score;

  result.overall_summary =
    overall >= 70
      ? "입력된 채널의 기본 운영 상태가 안정적입니다. 의료진·공간·상담 동선 이미지를 전문 촬영으로 보강하면 상담 전환율이 더 올라갈 수 있습니다."
      : overall >= 45
        ? "채널 운영 흔적은 있으나 이미지 일관성과 SEO 신뢰 요소 보완이 필요합니다. 전문 촬영 자산으로 대표 이미지를 통일하면 브랜딩 완성도가 높아집니다."
        : "채널 전반에 걸쳐 전문 사진 콘텐츠와 SEO 기반 정보가 부족합니다. 원장 프로필·공간 촬영을 우선 진행하고 구조화 데이터 추가를 병행하는 것을 권장합니다.";

  result.photo_opportunity = instaDeep.primary_photo_opportunity;

  // SEO 인사이트 별도 섹션으로 추출
  const webDetail = (web.detail || {}) as any;
  const seoInsights = args.urls.web ? [
    webDetail.hasJsonLd ? "구조화 데이터(JSON-LD) 있음 — AI 검색 노출 유리" : "구조화 데이터 없음 — MedicalBusiness 스키마 추가 권장",
    webDetail.hasFaq    ? "FAQ 섹션 있음 — AI 검색 직접 인용 가능" : "FAQ 없음 — 자주 묻는 진료 Q&A 섹션 추가 권장",
    `alt 태그 적용률 ${webDetail.altRatio ?? 0}% — ${(webDetail.altRatio ?? 0) < 50 ? "이미지 alt 보완 필요" : "양호"}`,
    `JSON-LD 타입: ${(webDetail.jsonLdTypes || []).join(", ") || "없음"}`
  ] : [];

  return {
    ...result,
    insta_deep_report: instaDeep,
    seo_insights: seoInsights,
    report_sections: buildReportSections(instaDeep, result),
    package_recommendation: buildPackageRecommendation(result.overall_score, args.activeChannels)
  };
}

function buildPrompt(args: any, base: any) {
  return `당신은 포토클리닉 병원 채널 브랜딩 컨설턴트입니다. 아래 실제 수집 데이터와 자체 채점 결과를 바탕으로 문장만 더 설득력 있게 다듬으세요.
숫자와 원점수는 유지하고, 추정이 불확실한 부분은 "확인 필요"로 표현하세요. JSON만 반환하세요.

병원명: ${args.hospName} / 진료과목: ${args.specialty||"미입력"}
입력 채널: ${args.activeChannels.map((k: ChannelKey)=>CHANNEL_LABELS[k]).join(", ")}
수집 데이터: ${JSON.stringify(args.collected).slice(0, 10000)}
자체 분석 결과: ${JSON.stringify(base).slice(0, 8000)}

반환 형식:
{
  "overall_summary":"3문장 이내",
  "photo_opportunity":"촬영 개선 핵심 1문장",
  "insta_deep_report":{"executive_summary":"2문장","medical_branding_comment":"2문장","next_actions":["...","...","..."]},
  "package_recommendation":{"name":"추천 촬영 구성명","reason":"추천 이유 1문장","items":["...","...","..."]}
}`;
}

// ─────────────────────────────────────────────
// INSTAGRAM DEEP REPORT
// ─────────────────────────────────────────────
function buildInstagramDeepReport(data: InstagramSnapshot | null) {
  if (!data?.ok) {
    return {
      executive_summary: "인스타그램 데이터가 충분히 수집되지 않아 상세 분석을 제한적으로 표시합니다.",
      medical_branding_comment: "원장 얼굴, 공간 실체감, 상담 CTA를 피드에 정기적으로 노출하는 것이 병원 신뢰 구축의 핵심입니다.",
      primary_photo_opportunity: "계정 수집이 안정화되면 원장 프로필·공간·진료 연출의 부족 여부를 우선 확인하세요.",
      metrics: [], content_mix: [], top_posts: [], hashtag_insights: [], caption_keywords: [],
      trust_checklist: ["의료진 얼굴 노출", "공간 실체감", "상담/예약 안내", "진료 과정 설명"],
      conversion_checklist: ["프로필 링크", "상담 CTA", "대표 진료 키워드", "문의 동선"],
      next_actions: ["Apify 토큰과 3개 스크래퍼 설정 확인", "인스타그램 URL 재입력", "게시물 수집 후 리포트 재생성"]
    };
  }

  const posts   = data.latest_posts || [];
  const profile = data.profile      || {};
  const captions = posts.map(p => p.caption || "").join(" ");
  const hashCounts = countItems(posts.flatMap(p => p.hashtags || []));
  const keywords   = keywordCounts(captions, ["원장","의료진","상담","예약","시술","치료","공간","장비","후기","전후","안전","위생","피부","성형","치과","통증"]);
  const contentMix = buildContentMix(posts);
  const followers  = asNumber(profile.followersCount) || 0;
  const externalUrl = asString(profile.externalUrl);
  const bio         = asString(profile.biography);
  const doctorCount = containsAnyCount(posts, ["원장","의료진","대표원장","doctor","dr.","전문의"]);
  const spaceCount  = containsAnyCount(posts, ["공간","내부","장비","시설","위생","안전"]);
  const ctaCount    = containsAnyCount(posts, ["상담","예약","문의","카카오","DM","전화"]);
  const reelCount   = posts.filter(p => /video|reel/i.test(p.type||"") || typeof p.videoViews==="number").length;

  return {
    executive_summary: `Apify 3개 스크래퍼 기준 최근 게시물 ${posts.length}건·프로필·반응 데이터를 통합했습니다. 평균 좋아요 ${data.avg_likes??"-"}, 참여율 ${data.engagement_rate??"-"}%를 기준으로 병원 신뢰·이미지·상담 전환 동선을 진단합니다.`,
    medical_branding_comment: "일반 SNS 수치보다 중요한 것은 환자가 병원을 선택하기 전에 느끼는 신뢰입니다. 의료진 얼굴, 실제 공간, 상담 장면, 진료 전문성이 피드에서 반복 노출되어야 합니다.",
    primary_photo_opportunity: reelCount === 0
      ? "릴스 없이 이미지만 운영 중 — 원장 인터뷰·시술 과정 릴스 1~2편 추가로 도달 즉시 확장 가능"
      : doctorCount < 2
        ? "의료진 등장 콘텐츠 부족 — 원장 얼굴 중심 사진+릴스 시리즈로 신뢰 구축 가능"
        : "원장 프로필·공간·시술 장면을 하나의 톤으로 촬영해 인스타·홈페이지·플레이스에 일괄 적용하는 것이 가장 효과적",
    metrics: [
      { label:"수집 게시물", value:`${posts.length}건` },
      { label:"평균 좋아요", value: data.avg_likes ?? "-" },
      { label:"평균 댓글",   value: data.avg_comments ?? "-" },
      { label:"참여율",      value: data.engagement_rate !== null ? `${data.engagement_rate}%` : "-" },
      { label:"팔로워",      value: followers ? followers.toLocaleString("ko-KR") : "-" },
      { label:"릴스 수",     value: reelCount },
      { label:"외부 링크",   value: externalUrl ? "있음" : "확인 필요" }
    ],
    content_mix: contentMix,
    top_posts: posts.slice().sort((a,b)=>(b.likes||0)+(b.comments||0)*3-((a.likes||0)+(a.comments||0)*3))
      .slice(0,5).map(p=>({ caption:cleanText(p.caption||"캡션 없음",90), likes:p.likes, comments:p.comments, type:classifyPostType(p), url:p.url })),
    hashtag_insights: Object.entries(hashCounts).slice(0,12).map(([tag,count])=>({ tag, count })),
    caption_keywords: keywords,
    trust_checklist: [
      `의료진/원장 언급 ${doctorCount}건`,
      `공간/장비 언급 ${spaceCount}건`,
      `상담/예약 CTA ${ctaCount}건`,
      bio ? "프로필 소개 확인됨" : "프로필 소개 데이터 부족"
    ],
    conversion_checklist: [
      externalUrl ? "외부 링크 확인됨" : "프로필 외부 링크 데이터 부족",
      followers ? `팔로워 ${followers.toLocaleString("ko-KR")}명 · 참여율 ${data.engagement_rate??"-"}%` : "팔로워 수 데이터 부족",
      `평균 좋아요 ${data.avg_likes??"-"} · 댓글 ${data.avg_comments??"-"}`,
      "프로필 → 상담 연결 동선은 별도 점검 필요"
    ],
    next_actions: [
      "상단 고정 게시물에 원장/대표 진료/상담 동선을 배치하세요.",
      reelCount < 3 ? "릴스를 주 1편 이상 추가해 도달 범위를 넓히세요." : "릴스 유지하며 캐러셀 비율을 30% 이상으로 맞추세요.",
      "반응 좋은 게시물의 주제와 촬영 톤을 다음 촬영 콘셉트 기준으로 삼으세요.",
      "게시물 말미 CTA와 프로필 링크를 상담 예약 중심으로 통일하세요."
    ]
  };
}

// ─────────────────────────────────────────────
// RESULT HELPERS
// ─────────────────────────────────────────────
function enrichResult(base: any, args: any, note: string) {
  const possiblePoints   = args.activeChannels.reduce((s: number, k: ChannelKey) => s + CHANNEL_WEIGHTS[k], 0);
  const rawTotal         = args.activeChannels.reduce((s: number, k: ChannelKey) => s + (base.channels[k]?.score || 0), 0);
  const normalizedOverall = possiblePoints > 0 ? Math.round((rawTotal / possiblePoints) * 100) : 0;
  const coverageSummary  = args.activeChannels.length === 1 && args.activeChannels[0] === "insta"
    ? "인스타그램 단독 분석"
    : `${args.activeChannels.map((k: ChannelKey) => CHANNEL_LABELS[k]).join(" · ")} 기준 종합 분석`;
  return {
    ...base, overall_score: normalizedOverall,
    analyzed_channels: args.activeChannels, possible_points: possiblePoints, raw_total_score: rawTotal,
    analysis_mode: args.activeChannels.length === 1 && args.activeChannels[0] === "insta" ? "instagram_only" : "channel_mix",
    coverage_summary: coverageSummary, data_note: note,
    data_sources: compactSources(args.collected),
    instagram_metrics: args.collected.instagram ? {
      ok: args.collected.instagram.ok, source: args.collected.instagram.source,
      post_count: args.collected.instagram.post_count, avg_likes: args.collected.instagram.avg_likes,
      avg_comments: args.collected.instagram.avg_comments, engagement_rate: args.collected.instagram.engagement_rate,
      error: args.collected.instagram.error
    } : null
  };
}

function buildReportSections(instaDeep: any, result: any) {
  return [
    { title:"Reading Guide", items:["일반 SNS 수치보다 병원 선택 전 신뢰를 만드는 요소로 재해석합니다.","의료진·공간·전문성의 실체가 피드에서 보이는지 확인합니다.","프로필 방문 이후 상담/예약으로 이어지는지 확인합니다."] },
    { title:"Instagram Deep Diagnosis", items:[instaDeep.executive_summary, instaDeep.medical_branding_comment, ...(instaDeep.next_actions||[])] },
    { title:"Channel Score Summary", items:Object.entries(result.channels).map(([key,value]:any)=>`${CHANNEL_LABELS[key as ChannelKey]} ${value.score}/${CHANNEL_WEIGHTS[key as ChannelKey]}점 · ${value.status}`) }
  ];
}

function buildPackageRecommendation(score: number, activeChannels: ChannelKey[]) {
  if (score < 45) return { name:"브랜드 기본 신뢰 회복 촬영", reason:"채널 첫인상을 만드는 기본 사진 자산부터 정리해야 합니다.", items:["원장 프로필","공간 대표컷","상담 장면","진료 연출컷"] };
  if (activeChannels.length >= 3) return { name:"4채널 통합 브랜딩 촬영", reason:"여러 채널에 동일한 톤의 사진 자산을 배포하는 구성이 필요합니다.", items:["원장/의료진 프로필","진료 연출","공간/장비","SNS 세로형 컷","네이버 플레이스 대표사진"] };
  return { name:"인스타그램 피드 리뉴얼 촬영", reason:"현재 운영 데이터 기반으로 반응 좋은 주제를 사진 자산으로 확장하는 구성입니다.", items:["대표 원장 프로필","상담/시술 연출","공간 무드컷","릴스 썸네일용 세로컷"] };
}

function buildDataNote(collected: { instagram: InstagramSnapshot | null; pages: Record<"web"|"naver"|"blog", PageSnapshot | null> }) {
  const parts: string[] = [];
  if (collected.instagram) parts.push(collected.instagram.ok ? `인스타그램 ${collected.instagram.post_count||0}건 수집` : `인스타그램 ${collected.instagram.source}`);
  for (const [key, page] of Object.entries(collected.pages)) if (page) parts.push(`${key} ${page.ok?`HTTP ${page.status}`:"수집 실패"}`);
  return parts.length ? parts.join(" · ") : "입력 URL 없음";
}

function compactSources(collected: { instagram: InstagramSnapshot | null; pages: Record<"web"|"naver"|"blog", PageSnapshot | null> }) {
  return {
    instagram: collected.instagram ? {
      ok: collected.instagram.ok, source: collected.instagram.source,
      actor_ids: collected.instagram.actor_ids,
      profile_items_count: collected.instagram.profile_items_count,
      general_items_count: collected.instagram.general_items_count,
      post_items_count: collected.instagram.post_items_count,
      post_count: collected.instagram.post_count,
      error: collected.instagram.error, errors: collected.instagram.errors
    } : null,
    pages: Object.fromEntries(Object.entries(collected.pages).map(([k,v])=>[k, v?{ok:v.ok,status:v.status,title:v.title,image_count:v.image_count,image_alt_count:v.image_alt_count,has_json_ld:v.has_json_ld,has_faq:v.has_faq,text_length:v.text_length,error:v.error}:null]))
  };
}

// ─────────────────────────────────────────────
// INSTAGRAM ANALYSIS HELPERS
// ─────────────────────────────────────────────
function buildContentMix(posts: InstaPost[]) {
  const total = posts.length || 1;
  return [
    { label:"릴스/영상",       count:posts.filter(p=>/video|reel/i.test(p.type||"")||typeof p.videoViews==="number").length },
    { label:"캐러셀",          count:posts.filter(p=>p.isCarousel).length },
    { label:"의료진/원장 언급", count:containsAnyCount(posts,["원장","의료진","대표원장","doctor","dr."]) },
    { label:"공간/장비 언급",  count:containsAnyCount(posts,["공간","내부","장비","시설","위생","안전"]) },
    { label:"상담/예약 CTA",   count:containsAnyCount(posts,["상담","예약","문의","카카오","DM","전화"]) }
  ].map(b=>({ ...b, ratio:Math.round((b.count/total)*100) }));
}

function classifyPostType(post: InstaPost) {
  if (post.isCarousel) return "캐러셀";
  if (/video|reel/i.test(post.type||"")||typeof post.videoViews==="number") return "릴스/영상";
  return "이미지";
}

function containsAnyCount(posts: InstaPost[], words: string[]) {
  return posts.filter(p=>words.some(w=>(p.caption||"").toLowerCase().includes(w.toLowerCase()))).length;
}

function countItems(items: string[]) {
  const counts: Record<string,number> = {};
  for (const raw of items) { const item=raw.replace(/^#/,"").trim(); if(!item)continue; counts[item]=(counts[item]||0)+1; }
  return Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1]));
}

function keywordCounts(text: string, words: string[]) {
  return words.map(w=>({ keyword:w, count:(text.match(new RegExp(w,"gi"))||[]).length }))
    .filter(x=>x.count>0).sort((a,b)=>b.count-a.count).slice(0,10);
}

// ─────────────────────────────────────────────
// PRIMITIVE HELPERS
// ─────────────────────────────────────────────
function asString(value: unknown): string { return typeof value==="string"?value:""; }
function asNumber(value: unknown): number|null { return typeof value==="number"&&Number.isFinite(value)?value:null; }
function average(values: number[]): number|null { if(!values.length)return null; return Math.round(values.reduce((s,v)=>s+v,0)/values.length); }
function normalizeStringArray(value: unknown): string[] {
  if(!Array.isArray(value))return[];
  return value.map(v=>typeof v==="string"?v.replace(/^#|^@/,""):"").filter(Boolean).slice(0,30);
}
function normalizeComments(value: unknown): string[] {
  if(!Array.isArray(value))return[];
  return value.map(v=>typeof v==="string"?v:typeof v==="object"&&v?asString((v as Record<string,unknown>).text)||asString((v as Record<string,unknown>).comment):"")
    .filter(Boolean).slice(0,5);
}
function extractHashtags(text: string): string[] { return Array.from(text.matchAll(/#([\p{L}\p{N}_]+)/gu)).map(m=>m[1]); }
function extractMentions(text: string): string[] { return Array.from(text.matchAll(/@([A-Za-z0-9._]+)/g)).map(m=>m[1]); }
function uniqueFilter<T>(value: T, index: number, arr: T[]) { return arr.indexOf(value)===index; }
function parseJson(txt: string): unknown|null {
  const s=txt.indexOf("{"),e=txt.lastIndexOf("}");
  if(s<0||e<0||e<=s)return null;
  try{return JSON.parse(txt.slice(s,e+1));}catch{return null;}
}
function mergeAiResult(base: any, ai: any) {
  return {
    ...base,
    overall_summary:   cleanText(String(ai.overall_summary   || base.overall_summary), 700),
    photo_opportunity: cleanText(String(ai.photo_opportunity  || base.photo_opportunity), 400),
    insta_deep_report: {
      ...base.insta_deep_report,
      executive_summary:      cleanText(String(ai.insta_deep_report?.executive_summary      || base.insta_deep_report?.executive_summary      || ""), 500),
      medical_branding_comment: cleanText(String(ai.insta_deep_report?.medical_branding_comment || base.insta_deep_report?.medical_branding_comment || ""), 500),
      next_actions: Array.isArray(ai.insta_deep_report?.next_actions) ? ai.insta_deep_report.next_actions.slice(0,5).map((v: unknown)=>String(v)) : base.insta_deep_report?.next_actions
    },
    package_recommendation: ai.package_recommendation || base.package_recommendation,
    data_note: `${base.data_note} · AI 문장 보정 적용`
  };
}
