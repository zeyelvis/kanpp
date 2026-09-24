import type { Metadata } from "next";
import { MeView } from "@/components/library/MeView";

export const metadata: Metadata = {
  title: "我的追剧",
  robots: { index: false, follow: false },
};

export default async function MePage({ searchParams }: PageProps<"/me">) {
  const tab = (await searchParams).tab === "history" ? "history" : "follows";
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:pt-8">
      <h1 className="mb-4 text-2xl font-bold">我的</h1>
      <MeView tab={tab} />
    </div>
  );
}
