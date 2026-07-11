import React from "react";
import { Sparkles, Info, ShieldCheck, Activity } from "lucide-react";

interface PDFReportTemplateProps {
  scan: any;
  userProfile: any;
  recentScores: number[];
}

export const PDFReportTemplate = React.forwardRef<HTMLDivElement, PDFReportTemplateProps>(
  ({ scan, userProfile, recentScores }, ref) => {
    if (!scan) return null;

    const dateStr = new Date(scan.taken_at + "T12:00:00").toLocaleDateString("en-IN", {
      day: "numeric", month: "long", year: "numeric"
    });

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
        className="w-[794px] min-h-[1123px] absolute top-[-9999px] left-[-9999px] overflow-hidden"
        style={{ fontFamily: "system-ui, sans-serif", backgroundColor: "#ffffff", color: "#0f172a" }}
      >
        {/* Header Strip */}
        <div className="border-b p-8 flex justify-between items-center" style={{ backgroundColor: "#f8fafc", borderColor: "#e2e8f0" }}>
          <div>
            <h1 className="text-3xl font-black tracking-tight" style={{ color: "#e11d48" }}>CORE AI</h1>
            <p className="text-sm font-semibold uppercase tracking-widest mt-1" style={{ color: "#64748b" }}>
              AI Wellness Report
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold" style={{ color: "#1e293b" }}>{userProfile?.name || "Member"}</h2>
            <p className="font-medium" style={{ color: "#64748b" }}>{dateStr}</p>
          </div>
        </div>

        <div className="p-10">
          <div className="flex gap-10 items-start">
            {/* Left Column: Photo & Score */}
            <div className="w-[300px] shrink-0 flex flex-col gap-8">
              <div className="rounded-2xl overflow-hidden border-4 shadow-sm" style={{ borderColor: "#f1f5f9" }}>
                {scan.photo_url ? (
                  <img src={scan.photo_url} alt="Scan" className="w-full h-auto aspect-square object-cover" crossOrigin="anonymous" />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center" style={{ backgroundColor: "#f1f5f9" }}>
                    <span style={{ color: "#94a3b8" }}>No Image</span>
                  </div>
                )}
              </div>

              <div className="rounded-2xl p-6 border text-center shadow-sm" style={{ backgroundColor: "#f8fafc", borderColor: "#e2e8f0" }}>
                <p className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: "#64748b" }}>Overall Score</p>
                <div className="text-6xl font-black mb-2" style={{ color: "#0f172a" }}>
                  {Math.round(scan.overall_score || 0)}
                  <span className="text-2xl" style={{ color: "#94a3b8" }}>/100</span>
                </div>
                {scan.classification && (
                  <div className="mt-4 py-1.5 px-3 rounded-full text-sm font-bold inline-block" style={{ backgroundColor: "#f3e8ff", color: "#7e22ce" }}>
                    {scan.classification.toUpperCase()}
                  </div>
                )}
              </div>

              {recentScores.length > 1 && (
                <div className="rounded-2xl p-6 border shadow-sm" style={{ backgroundColor: "#f8fafc", borderColor: "#e2e8f0" }}>
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
            </div>

            {/* Right Column: Details */}
            <div className="flex-1 flex flex-col gap-8">
              {/* Sub-scores */}
              {scan.sub_scores?.length > 0 && (
                <section>
                  <h3 className="text-lg font-black mb-4 flex items-center gap-2 border-b pb-2" style={{ color: "#1e293b", borderColor: "#e2e8f0" }}>
                    <ShieldCheck size={20} color="#f43f5e" />
                    CLINICAL METRICS
                  </h3>
                  <div className="flex flex-col gap-4">
                    {scan.sub_scores.map((sub: any, i: number) => (
                      <div key={i}>
                        <div className="flex justify-between font-bold mb-1">
                          <span style={{ color: "#334155" }}>{sub.category}</span>
                          <span style={{ color: "#64748b" }}>{sub.score}/100</span>
                        </div>
                        <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "#f1f5f9" }}>
                          <div 
                            className="h-full rounded-full"
                            style={{ width: `${sub.score}%`, background: "linear-gradient(to right, #fb7185, #a855f7)" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Observations */}
              {scan.observations?.length > 0 && (
                <section>
                  <h3 className="text-lg font-black mb-4 flex items-center gap-2 border-b pb-2" style={{ color: "#1e293b", borderColor: "#e2e8f0" }}>
                    <Info size={20} color="#f43f5e" />
                    KEY OBSERVATIONS
                  </h3>
                  <div className="flex flex-col gap-3">
                    {scan.observations.map((obs: any, i: number) => (
                      <div key={i} className="p-4 rounded-xl border" style={{ backgroundColor: "#f8fafc", borderColor: "#f1f5f9" }}>
                        <span className="font-bold block mb-1" style={{ color: "#1e293b" }}>{obs.area}</span>
                        <span className="text-sm leading-relaxed" style={{ color: "#475569" }}>{obs.note}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Recommendations */}
              {scan.recommendations?.length > 0 && (
                <section>
                  <h3 className="text-lg font-black mb-4 flex items-center gap-2 border-b pb-2" style={{ color: "#1e293b", borderColor: "#e2e8f0" }}>
                    <Sparkles size={20} color="#10b981" />
                    RECOMMENDED PROTOCOL
                  </h3>
                  <div className="flex flex-col gap-3">
                    {scan.recommendations.map((rec: any, i: number) => (
                      <div key={i} className="p-4 rounded-xl border" style={{ backgroundColor: "#ecfdf5", borderColor: "#d1fae5" }}>
                        <span className="font-bold block mb-1" style={{ color: "#065f46" }}>✓ {rec.ingredient}</span>
                        <span className="text-sm leading-relaxed block mb-1" style={{ color: "#475569" }}>{rec.why}</span>
                        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#059669" }}>{rec.how_to_use}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 w-full p-8 border-t text-center" style={{ backgroundColor: "#f8fafc", borderColor: "#f1f5f9" }}>
           <p className="text-sm font-bold" style={{ color: "#94a3b8" }}>Core AI — a product of Linear Ventures</p>
           <p className="text-xs font-medium mt-1" style={{ color: "#94a3b8" }}>
             health.linearventures.in • AI-generated observations only. Not a medical diagnosis.
           </p>
        </div>
      </div>
    );
  }
);
PDFReportTemplate.displayName = "PDFReportTemplate";
