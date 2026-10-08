import { readEmbeddedStudioSettings } from "../../../server/sanity/embedded-studio";
import { EmbeddedStudio } from "./embedded-studio";

export const dynamic = "force-dynamic";

export default function StudioPage() {
  const settings = readEmbeddedStudioSettings();
  if (!settings) return <main><h1>Studio unavailable in fixture mode</h1><p>Run Studio with an explicitly configured live content target.</p></main>;
  return <EmbeddedStudio projectId={settings.projectId} dataset={settings.dataset} previewOrigin={settings.previewOrigin} />;
}
