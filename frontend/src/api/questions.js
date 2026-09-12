import { apiRequest } from "./client.js";

/**
 * Fetch the clinical question bank for Guided Interrogation, FR 2.4.
 *
 * Returns only questions whose GhSL prompt is filmed and approved, and each
 * question carries its answer options nested inside it, so opening the bank is
 * one request rather than one per question mid consultation.
 */
export function fetchQuestions() {
  return apiRequest("/questions/");
}
