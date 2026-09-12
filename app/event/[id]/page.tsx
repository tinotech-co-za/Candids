import { notFound } from "next/navigation";
import { AlbumExperience } from "../../components/AlbumExperience";
export const metadata = {
  title: "Your event album",
  robots: { index: false, follow: false },
};
export default async function Event({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9]{16,64}$/.test(id)) notFound();
  return <AlbumExperience albumId={id} />;
}
