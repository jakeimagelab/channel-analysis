"use client";

import { useMemo, useRef, useState } from "react";

const CH = [
  { key: "insta", label: "인스타그램", dot: "#E85D2C", weight: 35 },
  { key: "web", label: "홈페이지", dot: "#4285F4", weight: 35 },
  { key: "naver", label: "네이버 플레이스", dot: "#03C75A", weight: 20 },
  { key: "blog", label: "블로그", dot: "#FF6600", weight: 10 }
] as const;

const STEPS = [
  "입력 URL 검증 중",
  "인스타그램 데이터 수집 중",
  "홈페이지/블로그/플레이스 페이지 확인 중",
  "채널별 근거 데이터 정리 중",
  "점수 계산 및 리포트 생성 중"
];

type ChannelKey = (typeof CH)[number]["key"];

type Finding = {
  type: "issue" | "good" | "tip";
  text: string;
};

type ChannelResult = {
  score: number;
  status: string;
  findings: Finding[];
};

type AnalyzeResult = {
  overall_score: number;
  overall_summary: string;
  photo_opportunity: string;
  channels: Record<ChannelKey, ChannelResult>;
  data_note?: string;
  data_sources?: Record<string, unknown>;
  analyzed_channels?: ChannelKey[];
  possible_points?: number;
  raw_total_score?: number;
  analysis_mode?: string;
  coverage_summary?: string;
  instagram_metrics?: {
    ok?: boolean;
    source?: string;
    post_count?: number;
    avg_likes?: number | null;
    avg_comments?: number | null;
    engagement_rate?: number | null;
    error?: string;
  } | null;
  insta_deep_report?: {
    executive_summary?: string;
    medical_branding_comment?: string;
    primary_photo_opportunity?: string;
    metrics?: Array<{ label: string; value: string | number | null }>;
    content_mix?: Array<{ label: string; count: number; ratio: number }>;
    top_posts?: Array<{ caption: string; likes?: number | null; comments?: number | null; type?: string; url?: string }>;
    hashtag_insights?: Array<{ tag: string; count: number }>;
    caption_keywords?: Array<{ keyword: string; count: number }>;
    trust_checklist?: string[];
    conversion_checklist?: string[];
    next_actions?: string[];
  };
  report_sections?: Array<{ title: string; items: string[] }>;
  package_recommendation?: { name: string; reason: string; items: string[] };
};

export default function Page() {
  const [hospName, setHospName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [urls, setUrls] = useState<Record<ChannelKey, string>>({
    insta: "",
    web: "",
    naver: "",
    blog: ""
  });
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [doneSteps, setDoneSteps] = useState<number[]>([]);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const resultRef = useRef<HTMLDivElement | null>(null);

  const displayName = useMemo(() => hospName.trim() || "분석 대상 병원", [hospName]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2500);
  };

  const updateUrl = (key: ChannelKey, value: string) => {
    setUrls((prev) => ({ ...prev, [key]: value }));
  };

  const runProgress = async () => {
    setDoneSteps([]);
    for (let i = 0; i < STEPS.length; i++) {
      setStepIdx(i);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      setDoneSteps((prev) => [...prev, i]);
    }
  };

  const startAnalysis = async () => {
    setError("");
    setResult(null);

    const hasAnyUrl = Object.values(urls).some((v) => v.trim());
    if (!hasAnyUrl) {
      showToast("분석할 URL을 하나 이상 입력해주세요");
      return;
    }

    setLoading(true);
    const progressPromise = runProgress();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospName: displayName,
          specialty: specialty.trim(),
          urls
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "분석 중 오류가 발생했습니다.");
      }

      await progressPromise;
      setResult(data.result);
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setError(message);
    } finally {
      setLoading(false);
      setStepIdx(-1);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    const text = `[포토클리닉 채널 분석]\n병원: ${displayName} | 종합 ${result.overall_score}점\n기준: ${result.coverage_summary || "입력 채널 기준"}\n분석일: ${new Date().toLocaleDateString("ko-KR")}\n\n${result.overall_summary}\n\n${result.photo_opportunity}`;
    await navigator.clipboard.writeText(text);
    showToast("복사되었습니다");
  };

  const goProposal = () => {
    showToast("다음 단계에서 견적서/제안서 프로그램과 연결하면 됩니다");
  };

  const pctClass = (p: number) => (p >= 70 ? "g" : p >= 50 ? "m" : "b");
  const fill = (p: number) => (p >= 70 ? "#155855" : p >= 50 ? "#C8860A" : "#C04A2A");
  const tagStyle = (score: number, weight: number) => {
    const r = score / weight;
    if (r >= 0.7) return { background: "#E1F0EB", color: "#0F3F3C" };
    if (r >= 0.4) return { background: "#FEF8EC", color: "#7A5200" };
    return { background: "#FDF0EB", color: "#7A1A0A" };
  };
  const ico = { issue: "⚠", good: "✓", tip: "→" } as const;
  const icol = { issue: "#C04A2A", good: "#155855", tip: "#185FA5" } as const;

  return (
    <>
      <nav>
        <a className="nav-logo" href="#">
          <Logo />
          <span className="nav-label">병원 채널 분석</span>
        </a>
        <a className="nav-link" href="https://www.photoclinic.kr" target="_blank" rel="noreferrer">
          포토클리닉 홈페이지 →
        </a>
      </nav>

      <div className="hero">
        <div className="hero-eyebrow">
          <div className="hero-eyebrow-dot" />
          Channel Analysis
        </div>
        <h1>
          인스타그램 분석기를 포함한
          <br />
          <em>포토클리닉 4채널 분석기</em>
        </h1>
        <p>
          인스타그램만 입력하면 인스타그램 분석기로,
          <br />
          여러 URL을 입력하면 4채널 종합 분석기로 작동합니다.
        </p>
        <div className="steps-wrap">
          {["URL 입력", "데이터 수집", "채널별 진단", "제안서 연결"].map((s, i) => (
            <div className="step" key={s}>
              <div className="step-n">{i + 1}</div>
              <div className="step-l">{s}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="main">
        <div className="input-card">
          <div className="input-card-head">
            <div className="section-step">1</div>
            <div className="section-title">병원 정보 입력</div>
            <div className="section-desc">
              분석할 병원의 이름과 채널 URL을 입력해주세요.
              <br />
              인스타그램 URL만 넣어도 기존 인스타그램 분석기처럼 사용할 수 있습니다.
            </div>
          </div>

          <div className="input-body">
            <div className="grid2">
              <div className="field">
                <label>병원명</label>
                <input value={hospName} onChange={(e) => setHospName(e.target.value)} placeholder="포토클리닉" />
              </div>
              <div className="field">
                <label>진료과목</label>
                <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="피부과, 성형외과, 치과" />
              </div>
            </div>

            <div className="grid2">
              {CH.map((ch) => (
                <div className="field" key={ch.key}>
                  <label>
                    <span className="ch-dot" style={{ background: ch.dot }} />
                    {ch.label}
                  </label>
                  <input type="url" value={urls[ch.key]} onChange={(e) => updateUrl(ch.key, e.target.value)} placeholder={placeholderFor(ch.key)} />
                </div>
              ))}
            </div>

            <div className="section-desc" style={{ marginTop: 8 }}>
              입력한 채널만 분석합니다. 종합 점수는 <strong>입력한 채널의 배점 합계를 100점으로 환산</strong>해서 보여줍니다.
            </div>
          </div>

          <div className="input-footer">
            <button className="analyze-btn" onClick={startAnalysis} disabled={loading}>
              {loading ? "분석 중..." : "채널 분석 시작하기"}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {error && <div className="error-box">{error}</div>}
          </div>
        </div>

        {loading && (
          <div className="prog-card">
            <div className="prog-label">채널 데이터를 수집하고 분석 중입니다...</div>
            <div>
              {STEPS.map((s, i) => {
                const done = doneSteps.includes(i);
                const active = stepIdx === i;
                return (
                  <div className="prog-row" key={s}>
                    <div className={`prog-ico ${done ? "done" : active ? "spin" : ""}`}>{done ? "✓" : active ? "…" : "○"}</div>
                    <div className={`prog-txt ${done ? "ok" : active ? "go" : ""}`}>{s}</div>
                  </div>
                );
              })}
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${Math.round((Math.max(doneSteps.length, 0) / STEPS.length) * 100)}%` }} />
            </div>
          </div>
        )}

        {result && (
          <div className="result-card" ref={resultRef}>
            <div className="result-top">
              <div>
                <div className="result-hosp">{displayName}</div>
                <div className="result-sub">
                  {(specialty.trim() ? `${specialty.trim()} · ` : "")}
                  {result.coverage_summary ? `${result.coverage_summary} · ` : ""}
                  분석일 {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
                </div>
              </div>
              <div className="result-score-wrap">
                <div className="result-score-lbl">입력 채널 기준 종합 점수</div>
                <div>
                  <span className="result-score-val">{result.overall_score}</span>
                  <span className="result-score-max"> / 100</span>
                </div>
              </div>
            </div>

            <div className="result-body">
              <div className="chips">
                {CH.map((ch) => {
                  const s = result.channels[ch.key]?.score ?? 0;
                  const p = Math.round((s / ch.weight) * 100);
                  return (
                    <div className="chip" key={ch.key}>
                      <div className="chip-lbl">{ch.label.replace("네이버 플레이스", "플레이스")}</div>
                      <div className={`chip-val ${pctClass(p)}`}>
                        {s}
                        <span className="chip-max">/{ch.weight}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sum-box">
                <div className="sum-title">종합 진단</div>
                <div className="sum-txt">{result.overall_summary}</div>
                <div className="sum-opp">📸 {result.photo_opportunity}</div>
                {result.coverage_summary && <div className="data-note">분석 범위: {result.coverage_summary}</div>}
                {typeof result.raw_total_score === "number" && typeof result.possible_points === "number" && (
                  <div className="data-note">원점수: {result.raw_total_score} / {result.possible_points}</div>
                )}
                {result.data_note && <div className="data-note">수집 기준: {result.data_note}</div>}
              </div>

              {result.insta_deep_report && (
                <div className="ch-block">
                  <div className="ch-head">
                    <span className="ch-tag" style={{ background: "#E1F0EB", color: "#0F3F3C" }}>Instagram Deep Report</span>
                    <div className="ch-bar"><div className="ch-bar-fill" style={{ width: "100%", background: "#155855" }} /></div>
                    <span className="ch-pts" style={{ color: "#155855" }}>APIFY</span>
                  </div>

                  <div className="sum-txt" style={{ marginBottom: 14 }}>
                    {result.insta_deep_report.executive_summary}
                    {result.insta_deep_report.medical_branding_comment ? ` ${result.insta_deep_report.medical_branding_comment}` : ""}
                  </div>

                  {result.insta_deep_report.metrics && result.insta_deep_report.metrics.length > 0 && (
                    <div className="chips" style={{ marginBottom: 14 }}>
                      {result.insta_deep_report.metrics.map((m, idx) => (
                        <div className="chip" key={`${m.label}-${idx}`}>
                          <div className="chip-lbl">{m.label}</div>
                          <div className="chip-val g" style={{ fontSize: 16 }}>{m.value ?? "-"}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {result.insta_deep_report.content_mix && result.insta_deep_report.content_mix.length > 0 && (
                    <div className="findings" style={{ marginBottom: 12 }}>
                      {result.insta_deep_report.content_mix.map((m, idx) => (
                        <div className="finding" key={`${m.label}-${idx}`}>
                          <span className="fi" style={{ color: "#155855" }}>•</span>
                          <span>{m.label}: {m.count}건 / {m.ratio}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {result.insta_deep_report.top_posts && result.insta_deep_report.top_posts.length > 0 && (
                    <div className="sum-box" style={{ marginBottom: 12 }}>
                      <div className="sum-title">반응 좋은 게시물 TOP</div>
                      {result.insta_deep_report.top_posts.map((p, idx) => (
                        <div className="sum-txt" key={`${p.caption}-${idx}`} style={{ marginBottom: 6 }}>
                          {idx + 1}. [{p.type || "게시물"}] {p.caption} · 좋아요 {p.likes ?? "-"} / 댓글 {p.comments ?? "-"}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="findings">
                    {(result.insta_deep_report.trust_checklist || []).slice(0, 4).map((item, idx) => (
                      <div className="finding" key={`trust-${idx}`}><span className="fi" style={{ color: "#155855" }}>✓</span><span>{item}</span></div>
                    ))}
                    {(result.insta_deep_report.conversion_checklist || []).slice(0, 4).map((item, idx) => (
                      <div className="finding" key={`conv-${idx}`}><span className="fi" style={{ color: "#185FA5" }}>→</span><span>{item}</span></div>
                    ))}
                  </div>

                  {(result.insta_deep_report.hashtag_insights?.length || result.insta_deep_report.caption_keywords?.length) ? (
                    <div className="data-note">
                      해시태그: {(result.insta_deep_report.hashtag_insights || []).slice(0, 8).map((h) => `#${h.tag}(${h.count})`).join(" ") || "데이터 부족"}<br />
                      키워드: {(result.insta_deep_report.caption_keywords || []).slice(0, 8).map((k) => `${k.keyword}(${k.count})`).join(" ") || "데이터 부족"}
                    </div>
                  ) : null}
                </div>
              )}

              {result.package_recommendation && (
                <div className="sum-box">
                  <div className="sum-title">추천 촬영 구성</div>
                  <div className="sum-txt"><strong>{result.package_recommendation.name}</strong> — {result.package_recommendation.reason}</div>
                  <div className="data-note">{result.package_recommendation.items.join(" · ")}</div>
                </div>
              )}

              {CH.map((ch) => {
                const d = result.channels[ch.key];
                if (!d) return null;
                const p = Math.round((d.score / ch.weight) * 100);
                return (
                  <div className="ch-block" key={ch.key}>
                    <div className="ch-head">
                      <span className="ch-tag" style={tagStyle(d.score, ch.weight)}>
                        {ch.label}
                      </span>
                      <div className="ch-bar">
                        <div className="ch-bar-fill" style={{ width: `${p}%`, background: fill(p) }} />
                      </div>
                      <span className="ch-pts" style={{ color: fill(p) }}>
                        {d.score}점
                      </span>
                    </div>
                    <div className="findings">
                      {d.findings.map((f, idx) => (
                        <div className="finding" key={`${f.type}-${idx}`}>
                          <span className="fi" style={{ color: icol[f.type] }}>
                            {ico[f.type]}
                          </span>
                          <span>{f.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="result-actions">
              <button className="btn-sec" onClick={copyResult}>
                결과 복사
              </button>
              <button className="btn-pri" onClick={goProposal}>
                제안서 만들기 →
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}

function placeholderFor(key: ChannelKey) {
  switch (key) {
    case "insta":
      return "https://instagram.com/photoclinic_kr";
    case "web":
      return "https://photoclinic.kr";
    case "naver":
      return "https://map.naver.com/...";
    case "blog":
      return "https://blog.naver.com/...";
  }
}

function Logo() {
  return (
    <svg className="nav-logo-svg" viewBox="0 0 220 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="PHOTOCLINIC">
      <circle cx="28" cy="28" r="22" fill="#E85D2C" />
      <circle cx="28" cy="28" r="22" fill="#155855" clipPath="url(#rclip)" />
      <defs>
        <clipPath id="rclip">
          <rect x="28" y="0" width="28" height="56" />
        </clipPath>
      </defs>
      <circle cx="28" cy="28" r="15" fill="#EB8F22" />
      <circle cx="28" cy="28" r="15" fill="#569082" clipPath="url(#rclip)" />
      <circle cx="28" cy="28" r="8" fill="white" />
      <line x1="28" y1="20" x2="28" y2="36" stroke="rgba(0,0,0,.12)" strokeWidth="1.2" />
      <line x1="21" y1="24" x2="35" y2="32" stroke="rgba(0,0,0,.12)" strokeWidth="1.2" />
      <line x1="21" y1="32" x2="35" y2="24" stroke="rgba(0,0,0,.12)" strokeWidth="1.2" />
      <text x="58" y="33" fontFamily="'Noto Sans KR',sans-serif" fontSize="19" fontWeight="700" fill="#E85D2C" letterSpacing="1">
        PHOTO
      </text>
      <text x="130" y="33" fontFamily="'Noto Sans KR',sans-serif" fontSize="19" fontWeight="700" fill="#155855" letterSpacing="1">
        CLINIC
      </text>
    </svg>
  );
}
