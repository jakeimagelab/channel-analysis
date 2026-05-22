"use client";

import { useMemo, useRef, useState } from "react";

const CH = [
  { key: "insta", label: "인스타그램", short: "INSTAGRAM", dot: "#E85D2C", weight: 35 },
  { key: "web", label: "홈페이지", short: "WEBSITE", dot: "#4285F4", weight: 35 },
  { key: "naver", label: "네이버 플레이스", short: "PLACE", dot: "#03C75A", weight: 20 },
  { key: "blog", label: "블로그", short: "BLOG", dot: "#FF6600", weight: 10 }
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
  const [detailOpen, setDetailOpen] = useState(false);
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
    setDetailOpen(false);

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

  const analyzedChannels = result?.analyzed_channels || [];
  const priorities = result ? getPriorityItems(result.channels, analyzedChannels) : [];
  const quickStats = result ? getQuickStats(result) : [];

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
              입력한 채널만 분석합니다. 점수는 <strong>입력한 채널의 배점 합계를 100점으로 환산</strong>하되, 인스타그램은 실제 이미지 판독 전에는 잠정 점수로 표시합니다.
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
                <div className="result-score-lbl">입력 채널 기준 잠정 점수</div>
                <div>
                  <span className="result-score-val">{result.overall_score}</span>
                  <span className="result-score-max"> / 100</span>
                </div>
              </div>
            </div>

            <div className="result-body">
              <div className="dashboard-grid">
                <div className="dashboard-card dashboard-hero-card">
                  <div className="dashboard-card-head">
                    <span className="dashboard-card-kicker">Overall Snapshot</span>
                    <span className={`dashboard-score-badge ${pctClass(result.overall_score)}`}>{gradeLabel(result.overall_score)}</span>
                  </div>
                  <div className="overview-flex">
                    <ScoreRing value={result.overall_score} max={100} label="잠정 점수" color={fill(result.overall_score)} />
                    <div className="overview-copy">
                      <div className="overview-title">한눈에 보는 채널 건강도</div>
                      <p className="overview-text">{result.overall_summary}</p>
                      <div className="overview-highlight">📸 {result.photo_opportunity}</div>
                    </div>
                  </div>
                </div>

                <div className="dashboard-card dashboard-meta-card">
                  <div className="dashboard-card-head">
                    <span className="dashboard-card-kicker">Quick Stats</span>
                    <span className="dashboard-card-note">요약 인포그래픽</span>
                  </div>
                  <div className="stats-grid">
                    {quickStats.map((item) => (
                      <StatTile key={item.label} label={item.label} value={item.value} note={item.note} />
                    ))}
                  </div>
                  {result.data_note && <div className="meta-footnote">수집 기준: {result.data_note}</div>}
                </div>
              </div>

              <div className="channel-score-board">
                {CH.map((ch) => {
                  const d = result.channels[ch.key];
                  if (!d) return null;
                  const p = Math.round((d.score / ch.weight) * 100);
                  const active = analyzedChannels.includes(ch.key);
                  return (
                    <div className={`channel-score-card ${active ? "active" : "inactive"}`} key={ch.key}>
                      <div className="channel-score-head">
                        <span className="channel-score-dot" style={{ background: ch.dot }} />
                        <span className="channel-score-name">{ch.label}</span>
                      </div>
                      <ScoreRing value={d.score} max={ch.weight} label={ch.short} color={fill(p)} size={90} compact />
                      <div className="channel-score-status">{active ? d.status : "미입력"}</div>
                    </div>
                  );
                })}
              </div>

              <div className="infographic-grid">
                <div className="infographic-panel">
                  <div className="sum-title">개선 우선순위</div>
                  <div className="priority-list">
                    {priorities.length ? (
                      priorities.map((item, idx) => (
                        <div className="priority-item" key={`${item.type}-${idx}`}>
                          <div className="priority-num">{idx + 1}</div>
                          <div>
                            <div className={`priority-type ${item.type}`}>{priorityLabel(item.type)}</div>
                            <div className="priority-text">{item.text}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="priority-empty">현재 표시할 우선순위 데이터가 없습니다.</div>
                    )}
                  </div>
                </div>

                <div className="infographic-panel">
                  <div className="sum-title">채널별 점수 요약</div>
                  <div className="channel-bar-list">
                    {CH.map((ch) => {
                      const d = result.channels[ch.key];
                      if (!d) return null;
                      const p = Math.round((d.score / ch.weight) * 100);
                      return (
                        <div className="channel-bar-row" key={`bar-${ch.key}`}>
                          <div className="channel-bar-label-wrap">
                            <span className="channel-bar-label">{ch.label}</span>
                            <span className="channel-bar-score">{d.score}/{ch.weight}</span>
                          </div>
                          <div className="channel-bar-track">
                            <div className="channel-bar-fill" style={{ width: `${p}%`, background: fill(p) }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {typeof result.raw_total_score === "number" && typeof result.possible_points === "number" && (
                    <div className="meta-footnote">원점수: {result.raw_total_score} / {result.possible_points}</div>
                  )}
                </div>
              </div>

              {result.analysis_mode === "instagram_only" && result.instagram_metrics && (
                <div className="metric-showcase">
                  <div className="sum-title">인스타그램 핵심 지표</div>
                  <div className="metric-showcase-grid">
                    <MetricCard label="수집 게시물" value={`${result.instagram_metrics.post_count ?? 0}건`} note="최근 게시물 기준" accent="teal" />
                    <MetricCard label="평균 좋아요" value={result.instagram_metrics.avg_likes ?? "-"} note="게시물 반응" accent="orange" />
                    <MetricCard label="평균 댓글" value={result.instagram_metrics.avg_comments ?? "-"} note="상담 대화 신호" accent="blue" />
                    <MetricCard label="참여율" value={result.instagram_metrics.engagement_rate ? `${result.instagram_metrics.engagement_rate}%` : "-"} note="APIFY 계산값 기준" accent="amber" />
                  </div>
                </div>
              )}

              <div className="detail-toggle-wrap">
                <button className="detail-toggle" onClick={() => setDetailOpen((v) => !v)}>
                  {detailOpen ? "자세히 닫기" : "자세히 보기"}
                  <span>{detailOpen ? "▲" : "▼"}</span>
                </button>
                <div className="detail-toggle-note">
                  Apify 3종 스크래퍼로 수집한 프로필·게시물·반응·해시태그·CTA 데이터를 더 자세히 확인합니다.
                </div>
              </div>

              {detailOpen && (
                <div className="detail-panel">
                  {result.insta_deep_report && (
                    <div className="detail-infographic-card">
                      <div className="dashboard-card-head">
                        <span className="dashboard-card-kicker">Instagram Deep Report</span>
                        <span className="dashboard-card-note">상세 인포그래픽</span>
                      </div>
                      <div className="sum-txt detail-summary-copy">
                        {result.insta_deep_report.executive_summary}
                        {result.insta_deep_report.medical_branding_comment ? ` ${result.insta_deep_report.medical_branding_comment}` : ""}
                      </div>

                      {result.insta_deep_report.metrics && result.insta_deep_report.metrics.length > 0 && (
                        <div className="metric-showcase-grid deep-grid">
                          {result.insta_deep_report.metrics.map((m, idx) => (
                            <MetricCard key={`${m.label}-${idx}`} label={m.label} value={m.value ?? "-"} note="APIFY 수집값" accent={metricAccent(idx)} />
                          ))}
                        </div>
                      )}

                      {result.insta_deep_report.content_mix && result.insta_deep_report.content_mix.length > 0 && (
                        <div className="detail-section-card strong-card">
                          <div className="sum-title">콘텐츠 믹스</div>
                          <div className="mix-list">
                            {result.insta_deep_report.content_mix.map((m, idx) => (
                              <div className="mix-row" key={`${m.label}-${idx}`}>
                                <div className="mix-head">
                                  <span>{m.label}</span>
                                  <span>{m.count}건 · {m.ratio}%</span>
                                </div>
                                <div className="mix-track">
                                  <div className="mix-fill" style={{ width: `${Math.min(100, Math.max(4, m.ratio))}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="detail-section-grid two-col">
                        {result.insta_deep_report.top_posts && result.insta_deep_report.top_posts.length > 0 && (
                          <div className="detail-section-card strong-card">
                            <div className="sum-title">반응 좋은 게시물 TOP</div>
                            <div className="top-post-list">
                              {result.insta_deep_report.top_posts.map((p, idx) => (
                                <div className="top-post-item" key={`${p.caption}-${idx}`}>
                                  <div className="top-post-rank">{idx + 1}</div>
                                  <div className="top-post-copy">
                                    <div className="top-post-type">{p.type || "게시물"}</div>
                                    <div className="top-post-caption">{truncate(p.caption || "캡션 없음", 100)}</div>
                                    <div className="top-post-meta">좋아요 {p.likes ?? "-"} · 댓글 {p.comments ?? "-"}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="detail-section-card strong-card">
                          <div className="sum-title">해시태그 / 키워드</div>
                          <div className="keyword-group">
                            <div className="keyword-group-title">해시태그</div>
                            <div className="keyword-pills">
                              {(result.insta_deep_report.hashtag_insights || []).slice(0, 10).map((h, idx) => (
                                <span className="keyword-pill" key={`${h.tag}-${idx}`}>#{h.tag} <em>{h.count}</em></span>
                              ))}
                            </div>
                          </div>
                          <div className="keyword-group">
                            <div className="keyword-group-title">캡션 키워드</div>
                            <div className="keyword-pills alt">
                              {(result.insta_deep_report.caption_keywords || []).slice(0, 10).map((k, idx) => (
                                <span className="keyword-pill alt" key={`${k.keyword}-${idx}`}>{k.keyword} <em>{k.count}</em></span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="detail-section-grid three-col">
                        <ChecklistCard title="병원 신뢰 체크" items={(result.insta_deep_report.trust_checklist || []).slice(0, 6)} icon="✓" tone="good" />
                        <ChecklistCard title="상담 전환 체크" items={(result.insta_deep_report.conversion_checklist || []).slice(0, 6)} icon="→" tone="tip" />
                        <ChecklistCard title="다음 액션" items={(result.insta_deep_report.next_actions || []).slice(0, 6)} icon="1" tone="issue" numbered />
                      </div>
                    </div>
                  )}

                  {result.package_recommendation && (
                    <div className="package-banner">
                      <div>
                        <div className="package-kicker">추천 촬영 구성</div>
                        <div className="package-name">{result.package_recommendation.name}</div>
                        <div className="package-reason">{result.package_recommendation.reason}</div>
                      </div>
                      <div className="package-items">
                        {result.package_recommendation.items.map((item, idx) => (
                          <span className="package-pill" key={`${item}-${idx}`}>{item}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.report_sections && result.report_sections.length > 0 && (
                    <div className="detail-section-grid two-col">
                      {result.report_sections.map((section, idx) => (
                        <div className="detail-section-card" key={`${section.title}-${idx}`}>
                          <div className="sum-title">{section.title}</div>
                          {(section.items || []).map((item, itemIdx) => (
                            <div className="detail-bullet" key={`${section.title}-${itemIdx}`}>• {item}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
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

function getQuickStats(result: AnalyzeResult) {
  const activeCount = result.analyzed_channels?.length || 0;
  const insta = result.instagram_metrics;
  return [
    { label: "분석 채널", value: `${activeCount}개`, note: result.coverage_summary || "입력 채널 기준" },
    { label: "원점수", value: typeof result.raw_total_score === "number" && typeof result.possible_points === "number" ? `${result.raw_total_score}/${result.possible_points}` : "-", note: "환산 전 점수" },
    { label: "게시물 수집", value: insta?.post_count ? `${insta.post_count}건` : "-", note: "인스타그램 최근 게시물" },
    { label: "주요 액션", value: result.package_recommendation?.name || "사진 보강", note: "추천 개선 방향" }
  ];
}

function getPriorityItems(channels: Record<ChannelKey, ChannelResult>, activeKeys: ChannelKey[]) {
  const items: Array<{ type: Finding["type"]; text: string }> = [];
  activeKeys.forEach((key) => {
    const findings = channels[key]?.findings || [];
    findings.forEach((finding) => {
      if (finding.type !== "good" && items.length < 6) {
        items.push({ type: finding.type, text: finding.text });
      }
    });
  });
  return items;
}

function priorityLabel(type: Finding["type"]) {
  if (type === "issue") return "우선 개선";
  if (type === "tip") return "실행 팁";
  return "강점";
}

function gradeLabel(score: number) {
  if (score >= 85) return "High";
  if (score >= 70) return "Good";
  if (score >= 50) return "Care";
  return "Risk";
}

function metricAccent(index: number) {
  return ["teal", "orange", "blue", "amber", "teal", "orange"][index % 6] as "teal" | "orange" | "blue" | "amber";
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
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

function ScoreRing({ value, max, label, color, size = 116, compact = false }: { value: number; max: number; label: string; color: string; size?: number; compact?: boolean }) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((safeValue / max) * 100))) : 0;
  const stroke = compact ? 8 : 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className={`score-ring-wrap ${compact ? "compact" : ""}`} style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="score-ring-svg">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#DCE8E5" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="score-ring-center">
        <div className="score-ring-value">{value}</div>
        <div className="score-ring-max">/ {max}</div>
        <div className="score-ring-label">{label}</div>
      </div>
    </div>
  );
}

function StatTile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
      {note ? <div className="stat-tile-note">{note}</div> : null}
    </div>
  );
}

function MetricCard({ label, value, note, accent = "teal" }: { label: string; value: string | number; note?: string; accent?: "teal" | "orange" | "blue" | "amber" }) {
  return (
    <div className={`metric-card ${accent}`}>
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value">{value}</div>
      {note ? <div className="metric-card-note">{note}</div> : null}
    </div>
  );
}

function ChecklistCard({ title, items, icon, tone, numbered }: { title: string; items: string[]; icon: string; tone: "good" | "tip" | "issue"; numbered?: boolean }) {
  return (
    <div className={`detail-section-card checklist-card ${tone}`}>
      <div className="sum-title">{title}</div>
      {items.length ? (
        items.map((item, idx) => (
          <div className="check-row" key={`${title}-${idx}`}>
            <span className={`check-icon ${tone}`}>{numbered ? idx + 1 : icon}</span>
            <span>{item}</span>
          </div>
        ))
      ) : (
        <div className="detail-bullet">표시할 데이터가 없습니다.</div>
      )}
    </div>
  );
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
