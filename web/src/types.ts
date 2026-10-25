import type { Field } from "./lib/fields.ts";
import type { OcrWord } from "./lib/locate.ts";
import type { Quad } from "./lib/quad.ts";

export type Step = "start" | "camera" | "reading" | "confirm" | "result" | "photos" | "letter" | "evidence";
export type HeadRef = React.RefObject<HTMLHeadingElement | null>;

export interface Sample {
  id: string;
  label: string;
  file: string;
  moveOut: string;
  leaseEnd: string;
  /** room scan to load with this sample */
  tags?: string;
}

export interface Job {
  phase: "flatten" | "read" | "done";
  rawUrl: string;
  rawW: number;
  rawH: number;
  quad: Quad | null;
  pageUrl: string;
  pageW: number;
  pageH: number;
  fields: Field[];
  /** OCR word boxes, shown faintly while the model reads */
  words: OcrWord[];
  /** false when OCR failed, so nothing could be placed on the page */
  ocrOk: boolean;
}

export type Decision = "yes" | "no";
