"use client";

import { useState } from "react";
import { useClient, useDocumentOperation, useValidationStatus, type DocumentActionComponent } from "sanity";
import { validatePublicationDraft } from "./publication-validation";

const API_VERSION = "2026-10-01";

export const controlledPublishAction: DocumentActionComponent = function ControlledPublishAction(props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; lines: readonly string[] }>();
  const studioClient = useClient({ apiVersion: API_VERSION });
  const publishedClient = studioClient.withConfig({ perspective: "published", useCdn: false });
  const draftClient = studioClient.withConfig({ perspective: "drafts", useCdn: false });
  const { publish } = useDocumentOperation(props.id, props.type);
  const validation = useValidationStatus(props.id, props.type, false);
  const schemaErrors = validation.validation.filter((marker) => marker.level === "error");
  const initialDraft = props.draft;
  if (!initialDraft) return null;
  const expectedDraftRevision = initialDraft._rev;

  async function handlePublish() {
    if (busy || publish.disabled || !props.ready) return;
    setBusy(true);
    setNotice({ title: "Checking publication", lines: ["Rechecking the saved revision and its published dependencies."] });
    try {
      if (validation.isValidating) {
        setNotice({ title: "Validation is still running", lines: ["Wait for Studio validation to finish, then try again."] });
        return;
      }
      if (schemaErrors.length > 0) {
        setNotice({ title: "This document is incomplete", lines: ["Resolve the validation errors shown in the document form before publishing."] });
        return;
      }
      const baseId = props.id.replace(/^drafts\./, "");
      const draftId = `drafts.${baseId}`;
      const current = await draftClient.getDocument(draftId) as (Record<string, unknown> & { _rev?: string }) | null;
      if (!current || !current._rev || current._rev !== expectedDraftRevision) {
        setNotice({ title: "The draft changed", lines: ["Reload the document so the latest saved revision can be checked."] });
        return;
      }
      const publishDocument = { ...current, _id: baseId, _type: props.type } as Record<string, unknown> & { _id: string; _type: string; _rev: string };
      const validationResult = await validatePublicationDraft(
        publishDocument,
        (query, params) => publishedClient.fetch(query, params),
      );
      if (validationResult.errors.length > 0) {
        setNotice({ title: "Publication requirements are not met", lines: validationResult.errors });
        return;
      }
      if (validationResult.calculatedMappingKey && current.mappingKey !== validationResult.calculatedMappingKey) {
        await draftClient.patch(draftId).ifRevisionId(current._rev).set({ mappingKey: validationResult.calculatedMappingKey }).commit();
        setNotice({ title: "AI mapping updated", lines: ["The mapping key was recalculated for the saved package identity. Review the draft again, then publish it."] });
        return;
      }
      const confirmed = await draftClient.getDocument(draftId) as { _rev?: string } | null;
      if (!confirmed || confirmed._rev !== current._rev) {
        setNotice({ title: "The draft changed", lines: ["A newer revision exists. Reload the document and retry publication."] });
        return;
      }
      if (props.published?._rev) publish.execute({ publishedRevisionId: props.published._rev });
      else publish.execute();
      props.onComplete();
    } catch {
      setNotice({ title: "Publication check failed", lines: ["The draft or a required published dependency could not be verified. Retry after confirming Sanity is available."] });
    } finally {
      setBusy(false);
    }
  }

  return {
    label: busy ? "Checking…" : "Publish",
    disabled: busy || !props.ready || Boolean(publish.disabled) || validation.isValidating,
    onHandle: () => { void handlePublish(); },
    dialog: notice ? {
      type: "dialog" as const,
      header: notice.title,
      content: <div>{notice.lines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>,
      footer: <button type="button" onClick={() => setNotice(undefined)}>Close</button>,
      onClose: () => setNotice(undefined),
    } : null,
  };
};
