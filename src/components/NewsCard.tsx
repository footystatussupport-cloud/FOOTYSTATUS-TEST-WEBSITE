import { Plus } from "lucide-react";

interface NewsCardProps {
  title?: string;
  content?: string;
  author?: string;
  date?: string;
  isEmpty?: boolean;
}

const NewsCard = ({ title, content, author, date, isEmpty = true }: NewsCardProps) => {
  if (isEmpty) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center justify-center w-full max-w-md border-2 border-dashed border-border rounded-lg py-8 cursor-pointer hover:border-navy transition-colors group">
          <Plus className="h-12 w-12 text-foreground group-hover:text-navy transition-colors" strokeWidth={1.5} />
        </div>
      </div>
    );
  }

  return (
    <article className="bg-card border border-border rounded-lg p-4 shadow-sm">
      <h3 className="font-bold text-lg mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm mb-3">{content}</p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{author}</span>
        <span>{date}</span>
      </div>
    </article>
  );
};

export default NewsCard;
