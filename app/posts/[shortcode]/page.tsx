import { PostDetail } from "@/components/PostDetail";

export default async function PostDetailPage({ params }: { params: Promise<{ shortcode: string }> }) {
  const { shortcode } = await params;
  return <PostDetail shortcode={shortcode} />;
}
