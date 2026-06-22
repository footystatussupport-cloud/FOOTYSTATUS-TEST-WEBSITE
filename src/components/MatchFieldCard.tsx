import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Goal {
  id: string;
  scorer_name: string;
  minute: number;
  team: string;
}

interface MatchFieldCardProps {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  isLive?: boolean;
  league?: string;
  onClick?: () => void;
}

const MatchFieldCard = ({ matchId, homeTeam, awayTeam, isLive, league, onClick }: MatchFieldCardProps) => {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    const fetchGoals = async () => {
      const { data } = await supabase
        .from("match_goals")
        .select("*")
        .eq("match_id", matchId)
        .order("minute", { ascending: true });

      if (data) {
        setGoals(data);
      }
    };
    fetchGoals();
  }, [matchId]);

  const homeGoals = goals.filter(g => g.team === "home");
  const awayGoals = goals.filter(g => g.team === "away");

  return (
    <div 
      onClick={onClick}
      className="bg-gradient-to-b from-green-700 to-green-800 rounded-xl p-4 cursor-pointer hover:shadow-lg transition-shadow border-2 border-green-600"
    >
      {/* League & Status */}
      <div className="flex items-center justify-between mb-3">
        {league && (
          <span className="text-xs text-white/80 font-medium">{league}</span>
        )}
        {isLive && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold text-white">LIVE</span>
          </div>
        )}
      </div>

      {/* Team Names */}
      <div className="flex justify-between mb-4">
        <span className="font-bold text-white text-sm">{homeTeam}</span>
        <span className="font-bold text-white text-sm">{awayTeam}</span>
      </div>

      {/* Field Layout */}
      <div className="relative min-h-[100px]">
        {/* Halfway Line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/40 -translate-x-1/2" />
        
        {/* Center Circle */}
        <div className="absolute left-1/2 top-1/2 w-12 h-12 border-2 border-white/40 rounded-full -translate-x-1/2 -translate-y-1/2" />
        
        {/* Center Dot */}
        <div className="absolute left-1/2 top-1/2 w-2 h-2 bg-white/40 rounded-full -translate-x-1/2 -translate-y-1/2" />

        {/* Home Goals (Left Side) */}
        <div className="absolute left-2 top-0 bottom-0 w-[calc(50%-24px)] flex flex-col justify-center gap-1">
          {homeGoals.map((goal) => (
            <div key={goal.id} className="flex items-center gap-1.5">
              <span className="text-white text-xs font-medium truncate max-w-[80px]">{goal.scorer_name}</span>
              <span className="text-white/70 text-[10px]">{goal.minute}'</span>
            </div>
          ))}
        </div>

        {/* Away Goals (Right Side) */}
        <div className="absolute right-2 top-0 bottom-0 w-[calc(50%-24px)] flex flex-col justify-center items-end gap-1">
          {awayGoals.map((goal) => (
            <div key={goal.id} className="flex items-center gap-1.5">
              <span className="text-white/70 text-[10px]">{goal.minute}'</span>
              <span className="text-white text-xs font-medium truncate max-w-[80px]">{goal.scorer_name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Final indicator for non-live */}
      {!isLive && (
        <div className="text-center mt-3">
          <span className="text-xs text-white/60">Final</span>
        </div>
      )}
    </div>
  );
};

export default MatchFieldCard;
