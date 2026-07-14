import React from "react";
import { Sparkles, Info, ShieldCheck, Activity } from "lucide-react";

interface PDFReportTemplateProps {
  scan: any;
  userProfile: any;
  recentScores: number[];
}

// Every `data-pdf-block` element is treated as atomic by the PDF export in
// wellness/page.tsx — it measures each one's position and never lets a page
// break fall inside it. The header/footer/watermark are NOT in this DOM tree
// at all; they're drawn directly by jsPDF on every generated page instead,
// since this component is captured once as a single tall image and sliced.
export const PDFReportTemplate = React.forwardRef<HTMLDivElement, PDFReportTemplateProps>(
  ({ scan, userProfile, recentScores }, ref) => {
    if (!scan) return null;

    // Create simple SVG polyline for trend graph
    const trendMax = 100;
    const trendMin = 0;
    const points = recentScores.map((score, i) => {
      const x = (i / (Math.max(1, recentScores.length - 1))) * 300;
      const y = 80 - ((score - trendMin) / (trendMax - trendMin)) * 80;
      return `${x},${y}`;
    }).join(" ");

    return (
      <div
        ref={ref}
        className="w-[794px] absolute top-[-9999px] left-[-9999px] p-10 flex flex-col gap-6"
        style={{ fontFamily: "system-ui, sans-serif", backgroundColor: "#ffffff", color: "#0f172a" }}
      >
        {/* Hero row: photo + score, side by side but both short and equal-height. */}
        <div className="flex gap-6 items-stretch" data-pdf-block="true">
          <div className="w-[180px] shrink-0 rounded-2xl overflow-hidden border-4 shadow-sm" style={{ borderColor: "#f1f5f9" }}>
            {scan.photo_url ? (
              <img src={`/api/wellness/photo-proxy?url=${encodeURIComponent(scan.photo_url)}`} alt="Scan" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: "#f1f5f9" }}>
                <span style={{ color: "#94a3b8" }}>No Image</span>
              </div>
            )}
          </div>

          <div className="flex-1 rounded-2xl p-6 border shadow-sm flex flex-col justify-center" style={{ backgroundColor: "#f8fafc", borderColor: "#e2e8f0" }}>
            <p className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: "#64748b" }}>Overall Score</p>
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="text-6xl font-black" style={{ color: "#0f172a" }}>
                {Math.round(scan.overall_score || 0)}
                <span className="text-2xl" style={{ color: "#94a3b8" }}>/100</span>
              </div>
              {scan.classification && (
                <div className="py-1.5 px-3 rounded-full text-sm font-bold inline-block" style={{ backgroundColor: "#f3e8ff", color: "#7e22ce" }}>
                  {scan.classification.toUpperCase()}
                </div>
              )}
              {scan.scan_type === "skin" && scan.skin_age_estimate != null && (
                <div className="py-1.5 px-3 rounded-full text-sm font-bold inline-block" style={{ backgroundColor: "#d1fae5", color: "#065f46" }}>
                  VISIBLE SKIN AGE: {scan.skin_age_estimate}
                </div>
              )}
              {scan.photo_quality && scan.photo_quality !== "good" && (
                <div className="py-1.5 px-3 rounded-full text-sm font-bold inline-block" style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>
                  {String(scan.photo_quality).toUpperCase()} PHOTO{scan.ai_confidence ? ` · ${String(scan.ai_confidence).toUpperCase()} CONFIDENCE` : ""}
                </div>
              )}
            </div>
          </div>
        </div>

        {recentScores.length > 1 && (
          <div className="rounded-2xl p-6 border shadow-sm" style={{ backgroundColor: "#f8fafc", borderColor: "#e2e8f0" }} data-pdf-block="true">
            <p className="text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: "#64748b" }}>
              <Activity size={16} /> Score Trend
            </p>
            <div className="w-full h-[80px] relative">
              <svg viewBox="0 0 300 80" className="w-full h-full overflow-visible">
                <polyline points={points} fill="none" stroke="#f43f5e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {recentScores.map((score, i) => {
                  const x = (i / (Math.max(1, recentScores.length - 1))) * 300;
                  const y = 80 - ((score - trendMin) / (trendMax - trendMin)) * 80;
                  return (
                    <circle key={i} cx={x} cy={y} r="6" fill="#ffffff" stroke="#f43f5e" strokeWidth="3" />
                  );
                })}
              </svg>
            </div>
            <div className="flex justify-between mt-2 text-xs font-semibold" style={{ color: "#94a3b8" }}>
              <span>Older</span>
              <span>Current</span>
            </div>
          </div>
        )}

        {/* Sub-scores — heading bundled with the first bar so the title never
            gets orphaned alone at the bottom of a page. */}
        {scan.sub_scores?.length > 0 && (
          <section className="flex flex-col gap-4">
            <div data-pdf-block="true">
              <h3 className="text-lg font-black mb-4 flex items-center gap-2 border-b pb-2" style={{ color: "#1e293b", borderColor: "#e2e8f0" }}>
                <ShieldCheck size={20} color="#f43f5e" />
                CLINICAL METRICS
              </h3>
              <SubScoreRow sub={scan.sub_scores[0]} />
            </div>
            {scan.sub_scores.slice(1).map((sub: any, i: number) => (
              <div key={i} data-pdf-block="true"><SubScoreRow sub={sub} /></div>
            ))}
          </section>
        )}

        {/* Observations */}
        {scan.observations?.length > 0 && (
          <section className="flex flex-col gap-3">
            <div data-pdf-block="true">
              <h3 className="text-lg font-black mb-4 flex items-center gap-2 border-b pb-2" style={{ color: "#1e293b", borderColor: "#e2e8f0" }}>
                <Info size={20} color="#f43f5e" />
                KEY OBSERVATIONS
              </h3>
              <ObservationCard obs={scan.observations[0]} />
            </div>
            {scan.observations.slice(1).map((obs: any, i: number) => (
              <div key={i} data-pdf-block="true"><ObservationCard obs={obs} /></div>
            ))}
          </section>
        )}

        {/* Recommendations */}
        {scan.recommendations?.length > 0 && (
          <section className="flex flex-col gap-3">
            <div data-pdf-block="true">
              <h3 className="text-lg font-black mb-4 flex items-center gap-2 border-b pb-2" style={{ color: "#1e293b", borderColor: "#e2e8f0" }}>
                <Sparkles size={20} color="#10b981" />
                RECOMMENDED PROTOCOL
              </h3>
              <RecommendationCard rec={scan.recommendations[0]} />
            </div>
            {scan.recommendations.slice(1).map((rec: any, i: number) => (
              <div key={i} data-pdf-block="true"><RecommendationCard rec={rec} /></div>
            ))}
          </section>
        )}
      </div>
    );
  }
);
PDFReportTemplate.displayName = "PDFReportTemplate";

function SubScoreRow({ sub }: { sub: any }) {
  // Severity-mapped bar color, matching the in-app report (green/amber/rose).
  const barColor = sub.score >= 80 ? "#10b981" : sub.score >= 60 ? "#f59e0b" : "#f43f5e";
  return (
    <div>
      <div className="flex justify-between font-bold mb-1">
        <span style={{ color: "#334155" }}>{sub.category}</span>
        <span style={{ color: barColor }}>{sub.score}/100</span>
      </div>
      <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "#f1f5f9" }}>
        <div className="h-full rounded-full" style={{ width: `${sub.score}%`, backgroundColor: barColor }} />
      </div>
    </div>
  );
}

function ObservationCard({ obs }: { obs: any }) {
  return (
    <div className="p-4 rounded-xl border" style={{ backgroundColor: "#f8fafc", borderColor: "#f1f5f9" }}>
      <span className="font-bold block mb-1" style={{ color: "#1e293b" }}>{obs.area}</span>
      <span className="text-sm leading-relaxed" style={{ color: "#475569" }}>{obs.note}</span>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: any }) {
  return (
    <div className="p-4 rounded-xl border" style={{ backgroundColor: "#ecfdf5", borderColor: "#d1fae5" }}>
      <span className="font-bold block mb-1" style={{ color: "#065f46" }}>
        ✓ {rec.ingredient}
        {rec.time_of_day && (
          <span className="ml-2 py-0.5 px-2 rounded-full text-xs font-bold" style={{ backgroundColor: "#ffffff", color: "#64748b", border: "1px solid #d1fae5" }}>
            {rec.time_of_day === "both" ? "AM + PM" : String(rec.time_of_day).toUpperCase()}
          </span>
        )}
      </span>
      <span className="text-sm leading-relaxed block mb-1" style={{ color: "#475569" }}>{rec.why}</span>
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#059669" }}>{rec.how_to_use}</span>
    </div>
  );
}
