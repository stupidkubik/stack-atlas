import {
  aiSignalType,
  choiceGuidanceType,
  comparisonCellType,
  criteriaBlockType,
  evidenceType,
  keyedTextType,
  portableTextType,
  safeLinkType,
  seoType,
  sourceKeysType,
  sourceListType,
  sourceType,
  sourceAwareCriterionType,
} from "./objects";
import { documentTypes } from "./documents";
import { pageSectionTypes, siteDocumentTypes, siteNavigationItemType } from "./site";

export const schemaTypes = [
  sourceType,
  seoType,
  safeLinkType,
  portableTextType,
  sourceKeysType,
  sourceListType,
  criteriaBlockType,
  evidenceType,
  keyedTextType,
  aiSignalType,
  sourceAwareCriterionType,
  comparisonCellType,
  choiceGuidanceType,
  siteNavigationItemType,
  ...pageSectionTypes,
  ...documentTypes,
  ...siteDocumentTypes,
];

export { documentTypes, pageSectionTypes, siteDocumentTypes };
