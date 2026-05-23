"use client";

import { useMemo, useRef, useState } from "react";

const CH = [
  { key: "insta", label: "인스타그램", weight: 35 },
  { key: "web",   label: "홈페이지",   weight: 35 },
  { key: "naver", label: "플레이스",   weight: 20 },
  { key: "blog",  label: "블로그",     weight: 10 }
] as const;

const STEPS = ["URL 확인", "Apify 데이터 수집", "채널별 진단", "SEO 분석", "리포트 생성"];

type ChannelKey = (typeof CH)[number]["key"];
type Finding = { type: "issue" | "good" | "tip"; text: string };
type ChannelResult = { score: number; status: string; findings: Finding[]; detail?: Record<string, unknown> };

type AnalyzeResult = {
  overall_score: number;
  overall_summary: string;
  photo_opportunity: string;
  channels: Record<ChannelKey, ChannelResult>;
  data_note?: string;
  analyzed_channels?: ChannelKey[];
  possible_points?: number;
  raw_total_score?: number;
  analysis_mode?: string;
  coverage_summary?: string;
  seo_insights?: string[];
  instagram_metrics?: {
    post_count?: number;
    avg_likes?: number | null;
    avg_comments?: number | null;
    engagement_rate?: number | null;
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
  const [hospName,  setHospName]  = useState("");
  const [specialty, setSpecialty] = useState("");
  const [urls, setUrls] = useState<Record<ChannelKey, string>>({ insta: "", web: "", naver: "", blog: "" });
  const [loading,   setLoading]   = useState(false);
  const [stepIdx,   setStepIdx]   = useState(-1);
  const [doneSteps, setDoneSteps] = useState<number[]>([]);
  const [result,    setResult]    = useState<AnalyzeResult | null>(null);
  const [toast,     setToast]     = useState("");
  const [error,     setError]     = useState("");
  const resultRef = useRef<HTMLDivElement | null>(null);

  const displayName = useMemo(() => hospName.trim() || "분석 대상 병원", [hospName]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  };

  const updateUrl = (key: ChannelKey, value: string) => setUrls(prev => ({ ...prev, [key]: value }));

  const runProgress = async () => {
    setDoneSteps([]);
    for (let i = 0; i < STEPS.length; i++) {
      setStepIdx(i);
      await new Promise(resolve => window.setTimeout(resolve, 480));
      setDoneSteps(prev => [...prev, i]);
    }
  };

  const startAnalysis = async () => {
    setError("");
    setResult(null);
    if (!Object.values(urls).some(v => v.trim())) { showToast("분석할 URL을 하나 이상 입력해주세요"); return; }
    setLoading(true);
    const progressPromise = runProgress();
    try {
      const res  = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hospName: displayName, specialty: specialty.trim(), urls }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "분석 중 오류가 발생했습니다.");
      await progressPromise;
      setResult(data.result);
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setStepIdx(-1);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    const text = `[포토클리닉 채널 분석]\n병원: ${displayName}\n점수: ${result.overall_score}/100\n기준: ${result.coverage_summary||"입력 채널 기준"}\n\n${result.overall_summary}\n\n${result.photo_opportunity}`;
    await navigator.clipboard.writeText(text);
    showToast("복사되었습니다");
  };

  const deep          = result?.insta_deep_report;
  const topPosts      = deep?.top_posts      || [];
  const contentMix    = deep?.content_mix    || [];
  const trustItems    = deep?.trust_checklist    || [];
  const conversionItems = deep?.conversion_checklist || [];
  const actionItems   = deep?.next_actions   || [];
  const seoInsights   = result?.seo_insights || [];

  return (
    <>
      <nav className="clean-nav">
        <a className="nav-logo" href="#"><Logo /><span className="nav-label">병원 채널 분석</span></a>
        <a className="nav-link" href="https://www.photoclinic.kr" target="_blank" rel="noreferrer">포토클리닉 홈페이지 →</a>
      </nav>

      <section className="clean-hero">
        <div className="clean-kicker">PHOTO CLINIC Channel Report</div>
        <h1>병원 온라인 채널 진단 리포트</h1>
        <p>인스타그램·홈페이지·네이버 플레이스·블로그를<br />병원 브랜딩 + SEO 관점으로 정리합니다.</p>
      </section>

      <main className="clean-main">
        <section className="input-panel">
          <div className="input-head">
            <div>
              <div className="section-number">INPUT</div>
              <h2>분석 대상 입력</h2>
              <p>인스타그램만 입력해도 단독 리포트가 생성됩니다.</p>
            </div>
          </div>
          <div className="input-grid">
            <InputField label="병원명"        value={hospName}   onChange={setHospName}                   placeholder="포토클리닉" />
            <InputField label="진료과목"      value={specialty}  onChange={setSpecialty}                  placeholder="피부과, 성형외과, 치과" />
            <InputField label="인스타그램"    value={urls.insta} onChange={v => updateUrl("insta", v)}   placeholder="https://instagram.com/photoclinic_kr" />
            <InputField label="홈페이지"      value={urls.web}   onChange={v => updateUrl("web", v)}     placeholder="https://photoclinic.kr" />
            <InputField label="네이버 플레이스" value={urls.naver} onChange={v => updateUrl("naver", v)} placeholder="https://map.naver.com/..." />
            <InputField label="블로그"        value={urls.blog}  onChange={v => updateUrl("blog", v)}    placeholder="https://blog.naver.com/..." />
          </div>
          <button className="clean-analyze" onClick={startAnalysis} disabled={loading}>
            {loading ? "리포트 생성 중..." : "진단 리포트 생성"}
          </button>
          {error && <div className="error-box">{error}</div>}
        </section>

        {loading && (
          <section className="loading-panel">
            {STEPS.map((s, i) => {
              const done   = doneSteps.includes(i);
              const active = stepIdx === i;
              return <div className={`loading-step ${done ? "done" : active ? "active" : ""}`} key={s}><span>{done ? "✓" : i + 1}</span>{s}</div>;
            })}
          </section>
        )}

        {result && (
          <article className="report-card" ref={resultRef}>
            {/* COVER */}
            <header className="report-cover">
              <div>
                <div className="cover-kicker">PHOTO CLINIC Brand Report</div>
                <h2>{displayName}</h2>
                <p>{specialty.trim() ? `${specialty.trim()} · ` : ""}{result.coverage_summary || "입력 채널 기준"}</p>
                <p>진단일: {new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric" })}</p>
              </div>
              <div className="cover-score">
                <strong>{result.overall_score}</strong><span>/100</span><em>잠정 점수</em>
              </div>
            </header>

            {/* 01 EXECUTIVE SUMMARY */}
            <ReportSection no="01" title="Executive Summary" subtitle="대표원장님 또는 마케팅 담당자가 먼저 확인해야 할 핵심 요약입니다.">
              <div className="summary-box">
                <p>{result.overall_summary}</p>
                <strong>📸 {result.photo_opportunity}</strong>
              </div>
              <div className="priority-clean-grid">
                {getPriorityCards(result, trustItems, conversionItems, actionItems).map((item, idx) => (
                  <div className="priority-clean" key={`${item.title}-${idx}`}>
                    <span>PRIORITY {idx + 1}</span><h4>{item.title}</h4><p>{item.body}</p>
                  </div>
                ))}
              </div>
            </ReportSection>

            {/* 02 BRAND SCORES */}
            <ReportSection no="02" title="Brand Scores" subtitle="포토클리닉 채점 기준표(5항목×가중치)로 환산한 채널별 점수입니다.">
              <div className="score-clean-grid">
                {CH.map(ch => {
                  const d   = result.channels[ch.key];
                  const pct = d ? Math.round((d.score / ch.weight) * 100) : 0;
                  return <ScoreClean key={ch.key} label={ch.label} score={pct} detail={d ? `${d.score}/${ch.weight} · ${d.status}` : "미입력"} />;
                })}
              </div>
              {/* 채널별 세부 findings */}
              <div className="findings-channel-grid">
                {CH.map(ch => {
                  const d = result.channels[ch.key];
                  if (!d || !d.findings.length) return null;
                  return (
                    <div className="findings-channel-card" key={ch.key}>
                      <div className="findings-channel-head">
                        <span className="ch-key-badge">{ch.label}</span>
                        <span className="ch-key-score">{d.score}/{ch.weight}점</span>
                      </div>
                      {d.findings.map((f, i) => (
                        <div className={`finding-row finding-${f.type}`} key={i}>
                          <span>{f.type === "good" ? "✓" : f.type === "tip" ? "→" : "⚠"}</span>
                          <p>{f.text}</p>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </ReportSection>

            {/* 03 SEO / AI검색 인사이트 — 홈페이지 입력된 경우만 */}
            {(seoInsights.length > 0 || result.channels.web?.detail) && (
              <ReportSection no="03" title="SEO &amp; AI검색 최적화" subtitle="홈페이지의 검색엔진 노출 구조와 AI검색(SGE·Perplexity) 대응 현황입니다.">
                <div className="seo-grid">
                  {getSeoCards(result).map((card, idx) => (
                    <div className={`seo-card seo-${card.status}`} key={idx}>
                      <div className="seo-card-icon">{card.icon}</div>
                      <div className="seo-card-body">
                        <h4>{card.title}</h4>
                        <p>{card.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {seoInsights.length > 0 && (
                  <div className="seo-insight-list">
                    {seoInsights.map((s, i) => <div className="seo-insight-row" key={i}><span>→</span><p>{s}</p></div>)}
                  </div>
                )}
              </ReportSection>
            )}

            {/* 04 INSTAGRAM PROFILE */}
            <ReportSection no="04" title="Profile" subtitle="인스타그램 브랜드 신뢰도와 기본 전환 동선을 확인합니다.">
              <div className="profile-clean-grid">
                {getMetricCards(result).map(m => <MiniMetric key={m.label} label={m.label} value={m.value} />)}
              </div>
              {result.data_note && <p className="report-note">수집 기준: {result.data_note}</p>}
            </ReportSection>

            {/* 05 PERFORMANCE */}
            <ReportSection no="05" title="Performance" subtitle="인스타그램 콘텐츠 반응과 콘텐츠 타입 분포를 확인합니다.">
              <div className="performance-grid">
                <div className="performance-card">
                  <h4>상위 게시물 반응</h4>
                  <div className="top-reaction-list">
                    {topPosts.slice(0,6).map((p,idx) => <ReactionBar key={idx} index={idx+1} value={(p.likes||0)+(p.comments||0)} />)}
                    {!topPosts.length && <p className="empty-text">상위 게시물 데이터가 없습니다.</p>}
                  </div>
                </div>
                <div className="performance-card">
                  <h4>콘텐츠 타입 비중</h4>
                  <div className="mix-clean-list">
                    {contentMix.map((m,idx) => <MixRow key={`${m.label}-${idx}`} label={m.label} count={m.count} ratio={m.ratio} />)}
                    {!contentMix.length && <p className="empty-text">콘텐츠 타입 데이터가 없습니다.</p>}
                  </div>
                </div>
              </div>
            </ReportSection>

            {/* 06 DIAGNOSIS */}
            <ReportSection no="06" title="Diagnosis" subtitle="강점과 개선 액션을 콘텐츠 회의에 바로 사용할 수 있는 문장으로 정리했습니다.">
              <div className="diagnosis-grid">
                <DiagnosisList title="강점"    items={collectFindings(result,"good")} tone="good" />
                <DiagnosisList title="개선 액션" items={[...collectFindings(result,"issue"),...collectFindings(result,"tip")]} tone="action" />
              </div>
            </ReportSection>

            {/* 07 TOP POSTS */}
            <ReportSection no="07" title="Top Posts" subtitle="좋아요와 댓글 합산 기준 상위 콘텐츠입니다.">
              <div className="top-post-clean-list">
                {topPosts.slice(0,6).map((p,idx) => (
                  <div className="top-post-clean" key={`${p.caption}-${idx}`}>
                    <div className="post-rank">#{idx+1}</div>
                    <p>{truncate(p.caption||"캡션 없음",150)}</p>
                    <span>{p.type||"게시물"} · 좋아요 {p.likes??"-"} · 댓글 {p.comments??"-"}</span>
                    <strong>{(p.likes||0)+(p.comments||0)}</strong>
                  </div>
                ))}
                {!topPosts.length && <p className="empty-text">상위 게시물 데이터가 없습니다.</p>}
              </div>
            </ReportSection>

            {/* 08 PROPOSAL */}
            <ReportSection no="08" title="PhotoClinic Proposal Direction" subtitle="분석 결과를 포토클리닉 상담으로 연결하기 위한 제안입니다.">
              <div className="proposal-grid">
                {(result.package_recommendation?.items?.length ? result.package_recommendation.items : ["의료진 프로필","진료 연출 장면","공간 실체감"]).slice(0,4).map((item,idx) => (
                  <div className="proposal-card" key={`${item}-${idx}`}>
                    <h4>{item}</h4><p>{proposalText(item,idx)}</p>
                  </div>
                ))}
              </div>
              {result.package_recommendation && (
                <div className="proposal-summary">
                  <strong>{result.package_recommendation.name}</strong> — {result.package_recommendation.reason}
                </div>
              )}
            </ReportSection>

            <div className="result-actions clean-actions">
              <button className="btn-sec" onClick={copyResult}>결과 복사</button>
              <button className="btn-pri" onClick={() => showToast("제안서 기능으로 연결됩니다")}>제안서 만들기 →</button>
            </div>
          </article>
        )}
      </main>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}

// ─── Sub-components ───────────────────────────
function InputField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return <label className="clean-field"><span>{label}</span><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

function ReportSection({ no, title, subtitle, children }: { no: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <div className="report-section-head"><span>{no}</span><div><h3>{title}</h3><p>{subtitle}</p></div></div>
      {children}
    </section>
  );
}

function ScoreClean({ label, score, detail }: { label: string; score: number; detail: string }) {
  const color = score >= 70 ? "var(--teal)" : score >= 45 ? "var(--amber)" : "var(--red)";
  return <div className="score-clean"><strong style={{ color }}>{score}</strong><span>{label}</span><em>{detail}</em></div>;
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function ReactionBar({ index, value }: { index: number; value: number }) {
  const width = Math.min(100, Math.max(8, value));
  return <div className="reaction-row"><span>#{index}</span><div><i style={{ width:`${width}%` }} /></div><strong>{value}</strong></div>;
}

function MixRow({ label, count, ratio }: { label: string; count: number; ratio: number }) {
  return (
    <div className="mix-clean-row">
      <div><span>{label}</span><strong>{ratio}%</strong></div>
      <div className="mix-track-clean"><i style={{ width:`${Math.min(100,Math.max(5,ratio))}%` }} /></div>
      <em>{count}개</em>
    </div>
  );
}

function DiagnosisList({ title, items, tone }: { title: string; items: string[]; tone: "good"|"action" }) {
  return (
    <div className={`diagnosis-card ${tone}`}>
      <h4>{title}</h4>
      {items.slice(0,6).map((item,idx) => <p key={idx}>{item}</p>)}
      {!items.length && <p>표시할 내용이 없습니다.</p>}
    </div>
  );
}

// ─── Data helpers ─────────────────────────────
function getPriorityCards(result: AnalyzeResult, trustItems: string[], conversionItems: string[], actionItems: string[]) {
  const fallbackIssues = collectFindings(result, "issue");
  return [
    { title:"의료진 신뢰 콘텐츠 보강", body: trustItems[0]||fallbackIssues[0]||"원장님 프로필, 진료 철학, 설명 장면을 고정 시리즈화하세요." },
    { title:"상담 전환 동선 정리",      body: conversionItems[0]||fallbackIssues[1]||"게시물 말미 CTA와 하이라이트에서 같은 상담 경로를 반복 노출하세요." },
    { title:"저장형 콘텐츠와 릴스 병행", body: actionItems[0]||"도달용 릴스와 설득용 캐러셀을 함께 운영하면 상담 전환력이 높아집니다." }
  ];
}

function getSeoCards(result: AnalyzeResult): Array<{ icon: string; title: string; body: string; status: "good"|"warn"|"bad" }> {
  const detail = (result.channels?.web?.detail || {}) as Record<string, unknown>;
  const cards = [];

  // JSON-LD
  const hasJsonLd = Boolean(detail.hasJsonLd);
  const jsonTypes = Array.isArray(detail.jsonLdTypes) ? (detail.jsonLdTypes as string[]).join(", ") : "";
  cards.push({ icon: hasJsonLd ? "✓" : "✗", title:"구조화 데이터 (JSON-LD)", status: hasJsonLd ? "good" : "bad" as "good"|"bad",
    body: hasJsonLd ? `${jsonTypes||"타입 미상"} — AI검색·구글 리치결과 노출에 유리` : "JSON-LD 없음 — MedicalBusiness 스키마 추가 시 AI검색 노출 크게 개선" });

  // FAQ
  const hasFaq = Boolean(detail.hasFaq);
  cards.push({ icon: hasFaq ? "✓" : "→", title:"FAQ 섹션", status: hasFaq ? "good" : "warn" as "good"|"warn",
    body: hasFaq ? "FAQ 확인됨 — SGE·Perplexity 직접 인용 가능성 높음" : "FAQ 없음 — 자주 묻는 진료 질문 섹션 추가 시 AI검색 노출 상승" });

  // alt 비율
  const altRatio = typeof detail.altRatio === "number" ? detail.altRatio : 0;
  cards.push({ icon: altRatio >= 50 ? "✓" : "⚠", title:`이미지 alt 태그 (${altRatio}%)`, status: altRatio >= 70 ? "good" : altRatio >= 40 ? "warn" : "bad" as "good"|"warn"|"bad",
    body: altRatio >= 70 ? "alt 태그 양호 — 구글 이미지 검색·접근성 좋음" : "alt 태그 보완 필요 — 이미지 검색 노출과 SEO 점수에 영향" });

  // E-E-A-T (의료진 정보)
  const webFindings = result.channels?.web?.findings || [];
  const hasEeat = webFindings.some(f => f.type === "good" && f.text.includes("E-E-A-T"));
  cards.push({ icon: hasEeat ? "✓" : "⚠", title:"전문성 신호 (E-E-A-T)", status: hasEeat ? "good" : "warn" as "good"|"warn",
    body: hasEeat ? "원장·의료진 정보 확인 — 구글 의료 콘텐츠 신뢰 신호 양호" : "원장 소개·자격·경력 페이지 보강 시 검색 신뢰도 상승" });

  return cards;
}

function getMetricCards(result: AnalyzeResult) {
  const metrics   = result.insta_deep_report?.metrics || [];
  const findMetric = (name: string) => metrics.find(m => m.label.includes(name))?.value;
  return [
    { label:"FOLLOWERS",  value: findMetric("팔로") || "-" },
    { label:"ENGAGEMENT", value: result.instagram_metrics?.engagement_rate ? `${result.instagram_metrics.engagement_rate}%` : findMetric("참여") || "-" },
    { label:"POSTS",      value: findMetric("게시") || result.instagram_metrics?.post_count || "-" },
    { label:"AVG LIKES",  value: result.instagram_metrics?.avg_likes ?? "-" }
  ];
}

function collectFindings(result: AnalyzeResult, type: Finding["type"]) {
  return CH.flatMap(ch => result.channels[ch.key]?.findings || []).filter(f => f.type === type).map(f => f.text);
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function proposalText(item: string, idx: number) {
  const defaults = [
    "전문성과 친밀감을 함께 보여주는 대표원장/의료진 프로필 컷을 우선 보강합니다.",
    "상담, 설명, 장비 사용, 사후관리 장면을 통해 환자의 불안을 줄이는 증거 이미지를 만듭니다.",
    "대기실, 진료실, 장비, 동선 이미지를 정리해 방문 전 신뢰를 높입니다.",
    "인스타그램, 홈페이지, 플레이스, 블로그에 공통 적용 가능한 대표 이미지를 만듭니다."
  ];
  return defaults[idx] || `${item}을 중심으로 병원 브랜드 이미지를 정리합니다.`;
}

function Logo() {
  return (
    <svg className="nav-logo-svg" viewBox="0 0 220 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="PHOTOCLINIC">
      <circle cx="28" cy="28" r="22" fill="#E85D2C" />
      <circle cx="28" cy="28" r="22" fill="#155855" clipPath="url(#rclip)" />
      <defs><clipPath id="rclip"><rect x="28" y="0" width="28" height="56" /></clipPath></defs>
      <circle cx="28" cy="28" r="15" fill="#EB8F22" />
      <circle cx="28" cy="28" r="15" fill="#569082" clipPath="url(#rclip)" />
      <circle cx="28" cy="28" r="8"  fill="white" />
      <text x="58"  y="33" fontFamily="'Noto Sans KR',sans-serif" fontSize="19" fontWeight="700" fill="#E85D2C" letterSpacing="1">PHOTO</text>
      <text x="130" y="33" fontFamily="'Noto Sans KR',sans-serif" fontSize="19" fontWeight="700" fill="#155855" letterSpacing="1">CLINIC</text>
    </svg>
  );
}
