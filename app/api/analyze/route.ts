import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "insta" | "web" | "naver" | "blog";

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

type InstagramSnapshot = {
  input_url: string;
  ok: boolean;
  source: "apify" | "skipped" | "error";
  actor_id?: string;
  post_count?: number;
  avg_likes?: number | null;
  avg_comments?: number | null;
  latest_posts?: Array<{
    url?: string;
    caption?: string;
    likes?: number | null;
    comments?: number | null;
    timestamp?: string;
    type?: string;
    image?: string;
  }>;
  error?: string;
};

const CHANNELS = [
  { key: "insta", label: "인스타그램", weight: 35 },
  { key: "web", label: "홈페이지", weight: 35 },
  { key: "naver", label: "네이버 플레이스", weight: 20 },
  { key: "blog", label: "블로그", weight: 10 }
] as const;

const CHANNEL_WEIGHTS: Record<ChannelKey, number> = {
  insta: 35,
  web: 35,
  naver: 20,
  blog: 10
};

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  insta: "인스타그램",
  web: "홈페이지",
  naver: "네이버 플레이스",
  blog: "블로그"
};

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
    const [web, naver, blog] = await Promise.all([
      collectPage(urls.web || ""),
      collectPage(urls.naver || ""),
      collectPage(urls.blog || "")
    ]);

    const collected = {
      instagram,
      pages: { web, naver, blog }
    };

    const result = await analyzeWithClaudeOrHeuristic({
      hospName,
      specialty,
      urls,
      activeChannels,
      collected
    });

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
  return {
    insta: normalizeUrl(urls.insta),
    web: normalizeUrl(urls.web),
    naver: normalizeUrl(urls.naver),
    blog: normalizeUrl(urls.blog)
  };
}

function normalizeUrl(value?: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
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
    const title = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " "), 200);
    const description = getMeta(html, "description") || getMeta(html, "og:description");
    const h1 = getTagText(html, "h1", 4);
    const headings = [...getTagText(html, "h2", 6), ...getTagText(html, "h3", 6)].slice(0, 8);
    const imageCount = (html.match(/<img\b/gi) || []).length;
    const imageAltSamples = getImageAltSamples(html, 8);
    const textSample = cleanText(stripHtml(html), 1600);

    return {
      input_url: url,
      ok: res.ok,
      status: res.status,
      final_url: res.url,
      title,
      description,
      h1,
      headings,
      image_count: imageCount,
      image_alt_samples: imageAltSamples,
      text_sample: textSample
    };
  } catch (err) {
    return {
      input_url: url,
      ok: false,
      error: err instanceof Error ? err.message : "페이지 수집 실패"
    };
  }
}

async function collectInstagram(url: string): Promise<InstagramSnapshot | null> {
  if (!url) return null;

  const token = process.env.APIFY_TOKEN;
  const actorIdRaw = process.env.APIFY_INSTAGRAM_ACTOR_ID || "apify/instagram-scraper";
  const actorId = actorIdRaw.replace("/", "~");
  const limit = Number(process.env.APIFY_INSTAGRAM_LIMIT || 12);

  if (!token) {
    return {
      input_url: url,
      ok: false,
      source: "skipped",
      error: "APIFY_TOKEN 환경변수가 없어 인스타그램 게시물 수집을 건너뛰었습니다."
    };
  }

  try {
    const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`;
    const payload = {
      directUrls: [url],
      resultsType: "posts",
      resultsLimit: limit,
      addParentData: true,
      searchType: "user"
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(125000)
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        input_url: url,
        ok: false,
        source: "error",
        actor_id: actorIdRaw,
        error: `Apify 호출 실패: ${res.status} ${text.slice(0, 300)}`
      };
    }

    const items = (await res.json()) as Array<Record<string, unknown>>;
    const posts = items
      .map((item) => ({
        url: asString(item.url) || asString(item.shortCode) || "",
        caption: cleanText(asString(item.caption) || asString(item.firstComment) || "", 500),
        likes: asNumber(item.likesCount ?? item.likes),
        comments: asNumber(item.commentsCount ?? item.comments),
        timestamp: asString(item.timestamp) || asString(item.takenAt) || "",
        type: asString(item.type) || asString(item.productType) || "",
        image: asString(item.displayUrl) || asString(item.imageUrl) || asString(item.thumbnailUrl) || ""
      }))
      .slice(0, limit);

    const likeValues = posts.map((p) => p.likes).filter((v): v is number => typeof v === "number");
    const commentValues = posts.map((p) => p.comments).filter((v): v is number => typeof v === "number");

    return {
      input_url: url,
      ok: posts.length > 0,
      source: "apify",
      actor_id: actorIdRaw,
      post_count: posts.length,
      avg_likes: average(likeValues),
      avg_comments: average(commentValues),
      latest_posts: posts
    };
  } catch (err) {
    return {
      input_url: url,
      ok: false,
      source: "error",
      actor_id: actorIdRaw,
      error: err instanceof Error ? err.message : "Apify 인스타그램 수집 실패"
    };
  }
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

async function analyzeWithClaudeOrHeuristic(args: {
  hospName: string;
  specialty: string;
  urls: Record<ChannelKey, string>;
  activeChannels: ChannelKey[];
  collected: {
    instagram: InstagramSnapshot | null;
    pages: Record<"web" | "naver" | "blog", PageSnapshot | null>;
  };
}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return buildHeuristicResult(args, "ANTHROPIC_API_KEY가 없어 수집된 데이터 기준의 간이 채점으로 표시했습니다.");
  }

  const prompt = buildPrompt(args);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 1800,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const text = await res.text();
      return buildHeuristicResult(args, `Claude API 오류가 있어 간이 채점으로 표시했습니다. ${res.status}: ${text.slice(0, 160)}`);
    }

    const data = await res.json();
    const txt = Array.isArray(data.content) ? data.content.map((b: { text?: string }) => b.text || "").join("") : "";
    const parsed = parseJson(txt);
    if (!parsed) {
      return buildHeuristicResult(args, "Claude 응답 JSON 파싱에 실패해 간이 채점으로 표시했습니다.");
    }

    return enrichResult(ensureShape(parsed), args, buildDataNote(args.collected));
  } catch (err) {
    return buildHeuristicResult(args, err instanceof Error ? `Claude 호출 실패로 간이 채점했습니다. ${err.message}` : "Claude 호출 실패로 간이 채점했습니다.");
  }
}

function buildPrompt(args: {
  hospName: string;
  specialty: string;
  urls: Record<ChannelKey, string>;
  activeChannels: ChannelKey[];
  collected: {
    instagram: InstagramSnapshot | null;
    pages: Record<"web" | "naver" | "blog", PageSnapshot | null>;
  };
}) {
  return `당신은 병원 전문 사진·영상 브랜딩 컨설턴트(포토클리닉)입니다.
아래 "실제 수집 데이터"만 근거로 병원 온라인 채널을 평가하세요.
데이터가 부족하거나 수집 실패한 채널은 추정하지 말고, "데이터 부족" 또는 "추가 확인 필요"로 표현하세요.
이번 분석은 입력된 채널만 대상으로 하고, 종합 점수는 입력된 채널의 배점 합계를 100점으로 환산해 주세요.
입력된 채널: ${args.activeChannels.map((key) => CHANNEL_LABELS[key]).join(", ")}

병원명: ${args.hospName}
진료과목: ${args.specialty || "미입력"}
입력 URL: ${JSON.stringify(args.urls, null, 2)}

실제 수집 데이터:
${JSON.stringify(args.collected, null, 2)}

채점 기준:
- 인스타그램 35점: 피드 톤&매너, 전문사진 비율, 원장·스탭 등장, 공간·시술 사진, 화질·색보정
- 홈페이지 35점: 메시지·사진 일치, 톤&매너 일관성, 배치·레이아웃, 화질·색감, 원장·공간 사진
- 네이버 플레이스 20점: 대표 사진, 내부 사진, 의료진 사진, 최신성
- 블로그 10점: 사진 품질, 사진·글 일치

반드시 아래 JSON만 반환하세요. 마크다운, 설명문, 코드블록 금지.
{
  "overall_score": 58,
  "overall_summary": "현재 상태 2문장 + 전문 사진의 효과 1문장.",
  "photo_opportunity": "촬영으로 가장 먼저 개선될 핵심 한 문장.",
  "channels": {
    "insta": {"score":21,"status":"보통","findings":[{"type":"issue","text":"..."},{"type":"issue","text":"..."},{"type":"good","text":"..."},{"type":"tip","text":"..."}]},
    "web": {"score":25,"status":"보통","findings":[{"type":"issue","text":"..."},{"type":"issue","text":"..."},{"type":"good","text":"..."},{"type":"tip","text":"..."}]},
    "naver": {"score":10,"status":"미흡","findings":[{"type":"issue","text":"..."},{"type":"issue","text":"..."},{"type":"good","text":"..."},{"type":"tip","text":"..."}]},
    "blog": {"score":5,"status":"보통","findings":[{"type":"issue","text":"..."},{"type":"good","text":"..."},{"type":"tip","text":"..."}]}
  }
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

function ensureShape(value: unknown) {
  const v = value as Record<string, any>;
  const channels = v?.channels || {};
  return {
    overall_score: clampScore(Number(v?.overall_score || 0), 100),
    overall_summary: cleanText(String(v?.overall_summary || "수집된 데이터를 바탕으로 채널 상태를 분석했습니다."), 500),
    photo_opportunity: cleanText(String(v?.photo_opportunity || "원장 프로필과 공간 사진을 우선 정비하는 것이 좋습니다."), 300),
    channels: {
      insta: ensureChannel(channels.insta, 35, "인스타그램"),
      web: ensureChannel(channels.web, 35, "홈페이지"),
      naver: ensureChannel(channels.naver, 20, "네이버 플레이스"),
      blog: ensureChannel(channels.blog, 10, "블로그")
    }
  };
}

function ensureChannel(value: unknown, max: number, label: string) {
  const v = value as Record<string, any>;
  const findings = Array.isArray(v?.findings) ? v.findings : [];
  return {
    score: clampScore(Number(v?.score || 0), max),
    status: cleanText(String(v?.status || "확인 필요"), 20),
    findings: findings.slice(0, 4).map((f: any) => ({
      type: ["issue", "good", "tip"].includes(f?.type) ? f.type : "tip",
      text: cleanText(String(f?.text || `${label} 추가 확인이 필요합니다.`), 160)
    }))
  };
}

function clampScore(value: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function buildHeuristicResult(
  args: {
    hospName: string;
    specialty: string;
    urls: Record<ChannelKey, string>;
    activeChannels: ChannelKey[];
    collected: {
      instagram: InstagramSnapshot | null;
      pages: Record<"web" | "naver" | "blog", PageSnapshot | null>;
    };
  },
  note: string
) {
  const insta = scoreInstagram(args.collected.instagram, Boolean(args.urls.insta));
  const web = scorePage(args.collected.pages.web, Boolean(args.urls.web), 35, "홈페이지");
  const naver = scorePage(args.collected.pages.naver, Boolean(args.urls.naver), 20, "네이버 플레이스");
  const blog = scorePage(args.collected.pages.blog, Boolean(args.urls.blog), 10, "블로그");

  const base = {
    overall_score: 0,
    overall_summary:
      "입력된 채널 기준으로 온라인 채널 상태를 정리했습니다. 병원 대표 이미지와 원장 신뢰 요소를 일관되게 보강하면 같은 데이터 안에서도 체감 품질이 크게 좋아질 수 있습니다.",
    photo_opportunity:
      "원장 프로필 + 병원 공간 + 진료 연출 사진을 한 번에 촬영해 인스타그램·홈페이지·플레이스·블로그에 공통 적용하는 것이 가장 효율적입니다.",
    channels: { insta, web, naver, blog }
  };

  const result = enrichResult(base, args, `${note} ${buildDataNote(args.collected)}`);

  const overall = result.overall_score;
  result.overall_summary =
    overall >= 70
      ? "입력된 채널 기준으로 보면 기본 운영 상태와 정보 노출은 비교적 안정적입니다. 다만 실제 병원 분위기와 의료진 신뢰를 더 선명하게 보여주는 사진 구성이 보강되면 전환력이 더 좋아질 수 있습니다. 전문 촬영 이미지를 공통 자산으로 묶는 전략이 유효합니다."
      : overall >= 45
        ? "입력된 채널 안에서 일부 운영 흔적은 보이지만, 사진 품질과 원장·공간 노출의 일관성은 추가 점검이 필요합니다. 채널마다 제각각인 이미지를 정리하고 대표 사진 자산을 통일하면 신뢰도와 상담 전환 흐름이 개선됩니다. 전문 촬영 자산이 가장 빠른 해결책입니다."
        : "입력된 채널 기준으로는 데이터가 부족하거나 이미지·의료진·공간 정보가 충분히 드러나지 않습니다. 원장 프로필, 진료 연출, 공간 사진을 먼저 확보해 핵심 채널의 대표 이미지를 정리하는 것이 우선입니다. 전문 사진 자산이 전체 브랜딩의 출발점이 됩니다.";

  return result;
}

function enrichResult(
  base: {
    overall_score: number;
    overall_summary: string;
    photo_opportunity: string;
    channels: Record<ChannelKey, { score: number; status: string; findings: Array<{ type: string; text: string }> }>;
  },
  args: {
    activeChannels: ChannelKey[];
    collected: {
      instagram: InstagramSnapshot | null;
      pages: Record<"web" | "naver" | "blog", PageSnapshot | null>;
    };
  },
  note: string
) {
  const possiblePoints = args.activeChannels.reduce((sum, key) => sum + CHANNEL_WEIGHTS[key], 0);
  const rawTotal = args.activeChannels.reduce((sum, key) => sum + (base.channels[key]?.score || 0), 0);
  const normalizedOverall = possiblePoints > 0 ? Math.round((rawTotal / possiblePoints) * 100) : 0;
  const analysisMode = args.activeChannels.length === 1 && args.activeChannels[0] === "insta" ? "instagram_only" : "channel_mix";
  const coverageSummary =
    args.activeChannels.length === 1 && args.activeChannels[0] === "insta"
      ? "인스타그램 단독 분석"
      : `${args.activeChannels.map((key) => CHANNEL_LABELS[key]).join(" · ")} 기준 종합 분석`;

  return {
    ...base,
    overall_score: normalizedOverall,
    analyzed_channels: args.activeChannels,
    possible_points: possiblePoints,
    raw_total_score: rawTotal,
    analysis_mode: analysisMode,
    coverage_summary: coverageSummary,
    data_note: note,
    data_sources: compactSources(args.collected),
    instagram_metrics: args.collected.instagram
      ? {
          ok: args.collected.instagram.ok,
          source: args.collected.instagram.source,
          post_count: args.collected.instagram.post_count,
          avg_likes: args.collected.instagram.avg_likes,
          avg_comments: args.collected.instagram.avg_comments,
          error: args.collected.instagram.error
        }
      : null
  };
}

function scoreInstagram(data: InstagramSnapshot | null, hadUrl: boolean) {
  if (!hadUrl) {
    return {
      score: 0,
      status: "미입력",
      findings: [
        { type: "issue", text: "인스타그램 URL이 입력되지 않아 채널 상태를 확인하지 못했습니다." },
        { type: "tip", text: "병원 대표 계정을 입력하면 최근 게시물 기반으로 사진 톤과 운영 상태를 점검할 수 있습니다." }
      ]
    };
  }
  if (!data?.ok) {
    return {
      score: 8,
      status: "데이터 부족",
      findings: [
        { type: "issue", text: data?.error || "인스타그램 게시물 수집에 실패했습니다." },
        { type: "tip", text: "Apify 토큰과 Actor ID를 확인하면 최근 게시물 기반 분석이 가능합니다." }
      ]
    };
  }

  const posts = data.post_count || 0;
  const hasEngagement = typeof data.avg_likes === "number" || typeof data.avg_comments === "number";
  const score = Math.min(35, 14 + Math.min(posts, 12) + (hasEngagement ? 5 : 0));
  return {
    score,
    status: score >= 25 ? "양호" : score >= 15 ? "보통" : "미흡",
    findings: [
      { type: "good", text: `Apify로 최근 게시물 ${posts}건을 수집했습니다.` },
      {
        type: hasEngagement ? "good" : "issue",
        text: hasEngagement ? `평균 반응은 좋아요 ${data.avg_likes ?? "-"}, 댓글 ${data.avg_comments ?? "-"} 수준입니다.` : "좋아요·댓글 수치가 충분히 수집되지 않았습니다."
      },
      { type: "tip", text: "게시물 이미지의 원장·스탭·공간 등장 비율을 기준으로 촬영 우선순위를 정리하세요." }
    ]
  };
}

function scorePage(data: PageSnapshot | null, hadUrl: boolean, max: number, label: string) {
  if (!hadUrl) {
    return {
      score: 0,
      status: "미입력",
      findings: [
        { type: "issue", text: `${label} URL이 입력되지 않아 분석에서 제외했습니다.` },
        { type: "tip", text: `${label} URL을 입력하면 사진 노출과 메시지 구조를 함께 확인할 수 있습니다.` }
      ]
    };
  }
  if (!data?.ok) {
    return {
      score: Math.max(2, Math.round(max * 0.2)),
      status: "수집 실패",
      findings: [
        { type: "issue", text: data?.error || `${label} 페이지를 읽지 못했습니다.` },
        { type: "tip", text: "접근 차단, 비공개, 로그인 필요 여부를 확인해주세요." }
      ]
    };
  }

  const hasTitle = Boolean(data.title);
  const hasDesc = Boolean(data.description);
  const imageScore = Math.min(3, Math.floor((data.image_count || 0) / 5));
  const textScore = data.text_sample && data.text_sample.length > 300 ? 2 : 0;
  const base = hasTitle ? 3 : 1;
  const raw = base + (hasDesc ? 2 : 0) + imageScore + textScore;
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

function buildDataNote(collected: {
  instagram: InstagramSnapshot | null;
  pages: Record<"web" | "naver" | "blog", PageSnapshot | null>;
}) {
  const parts = [] as string[];
  if (collected.instagram) {
    parts.push(collected.instagram.ok ? `인스타그램 ${collected.instagram.post_count || 0}건 수집` : `인스타그램 ${collected.instagram.source}`);
  }
  for (const [key, page] of Object.entries(collected.pages)) {
    if (page) parts.push(`${key} ${page.ok ? `HTTP ${page.status}` : "수집 실패"}`);
  }
  return parts.length ? parts.join(" · ") : "입력 URL 없음";
}

function compactSources(collected: {
  instagram: InstagramSnapshot | null;
  pages: Record<"web" | "naver" | "blog", PageSnapshot | null>;
}) {
  return {
    instagram: collected.instagram
      ? {
          ok: collected.instagram.ok,
          source: collected.instagram.source,
          post_count: collected.instagram.post_count,
          error: collected.instagram.error
        }
      : null,
    pages: Object.fromEntries(
      Object.entries(collected.pages).map(([k, v]) => [
        k,
        v
          ? {
              ok: v.ok,
              status: v.status,
              title: v.title,
              image_count: v.image_count,
              error: v.error
            }
          : null
      ])
    )
  };
}
