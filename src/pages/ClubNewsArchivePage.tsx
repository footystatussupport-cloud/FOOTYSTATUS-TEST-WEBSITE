import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/Header";
import { Input } from "@/components/ui/input";
import ClubNewsCardCompact from "@/components/club-news/ClubNewsCardCompact";
import { ClubNewsPostSummary, fetchClubNewsForTeam } from "@/lib/clubNews";

const ClubNewsArchivePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<ClubNewsPostSummary[]>([]);
  const [clubName, setClubName] = useState("Club");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const rows = await fetchClubNewsForTeam(id);
        setPosts(rows);
        if (rows[0]?.club_name) setClubName(rows[0].club_name);
      } catch {
        setPosts([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const filteredPosts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return posts;
    return posts.filter((post) => `${post.title} ${post.body}`.toLowerCase().includes(query));
  }, [posts, search]);

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
        <Header />
        <div className="px-4 py-6">
          <button onClick={() => navigate(id ? `/team/${id}` : "/")} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="mb-4">
            <h1 className="text-2xl font-bold">{`${clubName}'s News/Updates`}</h1>
            <p className="text-sm text-muted-foreground mt-1">Full archive of every post from this club.</p>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search posts" className="pl-9" />
          </div>

          {loading ? (
            <div className="rounded-xl border border-border bg-card px-4 py-5 text-sm text-muted-foreground">Loading archive...</div>
          ) : filteredPosts.length > 0 ? (
            <div className="space-y-3">
              {filteredPosts.map((post) => (
                <ClubNewsCardCompact
                  key={post.id}
                  post={post}
                  onClick={() => navigate(`/club-news/${post.id}`)}
                  onOpenClubProfile={() => navigate(`/team/${post.team_id}`)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              {search.trim() ? "No posts match that search yet." : "No news posts have been published yet."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClubNewsArchivePage;
