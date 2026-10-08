"use client";

import { useMemo } from "react";
import { NextStudio } from "next-sanity/studio";
import { createStudioConfig, type StudioPublicSettings } from "../../../../studio/config";

export function EmbeddedStudio({ projectId, dataset, previewOrigin }: StudioPublicSettings) {
  const config = useMemo(() => ({ ...createStudioConfig({ projectId, dataset, previewOrigin }), basePath: "/studio" }), [projectId, dataset, previewOrigin]);
  return <NextStudio config={config} />;
}
