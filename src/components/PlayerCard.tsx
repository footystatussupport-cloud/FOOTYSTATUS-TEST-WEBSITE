import { User } from "lucide-react";
import ProBadge from "@/components/ProBadge";

interface PlayerCardProps {
  id: string;
  name: string;
  club: string;
  league: string;
  position?: string;
  profileImageUrl?: string | null;
  isPro?: boolean;
  onClick?: () => void;
}

const PlayerCard = ({
  name,
  club,
  league,
  position,
  profileImageUrl,
  isPro,
  onClick,
}: PlayerCardProps) => {
  return (
    <div 
      className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <div className="w-14 h-14 rounded-full bg-foreground flex items-center justify-center overflow-hidden flex-shrink-0">
        {profileImageUrl ? (
          <img 
            src={profileImageUrl} 
            alt={name} 
            className="w-full h-full object-cover"
          />
        ) : (
          <User className="h-7 w-7 text-background" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground truncate">{name}</h3>
          {isPro ? <ProBadge compact /> : null}
        </div>
        <p className="text-sm text-muted-foreground">{club}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-navy font-medium">{league}</span>
          {position && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-xs text-muted-foreground">{position}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerCard;
