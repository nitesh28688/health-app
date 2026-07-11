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
        className="w-[794px] min-h-[1123px] bg-white text-slate-900 absolute top-[-9999px] left-[-9999px] overflow-hidden"
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        {/* Header Strip */}
        <div className="bg-slate-50 border-b border-slate-200 p-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black text-rose-600 tracking-tight">CORE AI</h1>
            <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest mt-1">
              Medical-Grade Analysis
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-slate-800">{userProfile?.name || "Member"}</h2>
            <p className="text-slate-500 font-medium">{dateStr}</p>
          </div>
        </div>

        <div className="p-10">
          <div className="flex gap-10 items-start">
            {/* Left Column: Photo & Score */}
            <div className="w-[300px] shrink-0 flex flex-col gap-8">
              <div className="rounded-2xl overflow-hidden border-4 border-slate-100 shadow-sm">
                {scan.photo_url ? (
                  <img src={scan.photo_url} alt="Scan" className="w-full h-auto aspect-square object-cover" crossOrigin="anonymous" />
                ) : (
                  <div className="w-full aspect-square bg-slate-100 flex items-center justify-center">
                    <span className="text-slate-400">No Image</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 text-center shadow-sm">
                <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-2">Overall Score</p>
                <div className="text-6xl font-black text-slate-900 mb-2">{Math.round(scan.overall_score || 0)}<span className="text-2xl text-slate-400">/100</span></div>
                {scan.classification && (
                  <div className="mt-4 py-1.5 px-3 bg-purple-100 text-purple-700 rounded-full text-sm font-bold inline-block">
                    {scan.classification.toUpperCase()}
                  </div>
                )}
                {scan.skin_age_estimate && (
                  <div className="mt-2 py-1.5 px-3 bg-emerald-100 text-emerald-700 rounded-full text-sm font-bold inline-block">
                    EST. AGE: {scan.skin_age_estimate}
                  </div>
                )}
              </div>

              {recentScores.length > 1 && (
                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 shadow-sm">
                   <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                     <Activity size={16} /> Score Trend
                   </p>
                   <div className="w-full h-[80px] relative">
                     <svg viewBox="0 0 300 80" className="w-full h-full overflow-visible">
                       <polyline points={points} fill="none" stroke="#f43f5e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                       {recentScores.map((score, i) => {
                          const x = (i / (Math.max(1, recentScores.length - 1))) * 300;
                          const y = 80 - ((score - trendMin) / (trendMax - trendMin)) * 80;
                          return (
                            <circle key={i} cx={x} cy={y} r="6" fill="#fff" stroke="#f43f5e" strokeWidth="3" />
                          );
                       })}
                     </svg>
                   </div>
                   <div className="flex justify-between mt-2 text-xs font-semibold text-slate-400">
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
                  <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
                    <ShieldCheck size={20} className="text-rose-500" />
                    CLINICAL METRICS
                  </h3>
                  <div className="flex flex-col gap-4">
                    {scan.sub_scores.map((sub: any, i: number) => (
                      <div key={i}>
                        <div className="flex justify-between font-bold text-slate-700 mb-1">
                          <span>{sub.category}</span>
                          <span className="text-slate-500">{sub.score}/100</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-rose-400 to-purple-500 rounded-full"
                            style={{ width: `${sub.score}%` }}
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
                  <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
                    <Info size={20} className="text-rose-500" />
                    KEY OBSERVATIONS
                  </h3>
                  <div className="flex flex-col gap-3">
                    {scan.observations.map((obs: any, i: number) => (
                      <div key={i} className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <span className="font-bold text-slate-800 block mb-1">{obs.area}</span>
                        <span className="text-slate-600 text-sm leading-relaxed">{obs.note}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Recommendations */}
              {scan.recommendations?.length > 0 && (
                <section>
                  <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
                    <Sparkles size={20} className="text-emerald-500" />
                    RECOMMENDED PROTOCOL
                  </h3>
                  <div className="flex flex-col gap-3">
                    {scan.recommendations.map((rec: any, i: number) => (
                      <div key={i} className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                        <span className="font-bold text-emerald-800 block mb-1">✓ {rec.ingredient}</span>
                        <span className="text-slate-600 text-sm leading-relaxed block mb-1">{rec.why}</span>
                        <span className="text-emerald-600/80 text-xs font-semibold uppercase tracking-wider">{rec.how_to_use}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 w-full p-8 border-t border-slate-100 bg-slate-50 text-center">
           <p className="text-sm font-bold text-slate-400">health.linearventures.in</p>
           <p className="text-xs font-medium text-slate-400 mt-1">AI-generated observations only. Not a medical diagnosis.</p>
        </div>
      </div>
    );
  }
);
PDFReportTemplate.displayName = "PDFReportTemplate";
