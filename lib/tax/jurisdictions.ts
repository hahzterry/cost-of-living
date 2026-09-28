/**
 * lib/tax/jurisdictions.ts
 *
 * Loads and validates the rate files in /data.
 *
 * TO EDIT A TAX RATE, YOU DO NOT TOUCH THIS FILE.
 * Open the matching JSON file in /data and change the number:
 *
 *   data/states/tx.json                  ← statewide rules
 *   data/localities/fort-worth-tx.json   ← local levies and sales tax
 *
 * Then set that field's `verifiedOn` to today's date so the UI stops warning.
 *
 * Imports are static, so the JSON is bundled at build time. No filesystem
 * access at runtime, which is what makes this work on Vercel's serverless
 * functions and at the edge.
 *
 * Requires: "resolveJsonModule": true in tsconfig.json (Next.js sets this).
 */

import type { LocalityProfile, PropertyTaxSystem, StateProfile } from './types';
import { parseLocality, parseState } from './schema';

import txRaw from '../../data/states/tx.json';
import coRaw from '../../data/states/co.json';
import ncRaw from '../../data/states/nc.json';
import flRaw from '../../data/states/fl.json';
import flRaw from '../../data/states/ga.json';

import fortWorthRaw from '../../data/localities/atlanta-ga.json';
import coloradoSpringsRaw from '../../data/localities/colorado-springs-co.json';
import charlotteRaw from '../../data/localities/charlotte-nc.json';
import tampaRaw from '../../data/localities/tampa-fl.json';

// Validation runs at module load. A malformed rate file fails the BUILD rather
// than producing a quietly wrong number in production — which is the entire
// point of paying the schema tax.
export const STATES: Record<string, StateProfile> = {
  TX: parseState(txRaw, 'data/states/tx.json') as StateProfile,
  CO: parseState(coRaw, 'data/states/co.json') as StateProfile,
  NC: parseState(ncRaw, 'data/states/nc.json') as StateProfile,
  FL: parseState(flRaw, 'data/states/fl.json') as StateProfile,
};

export const LOCALITIES: Record<string, LocalityProfile> = {
  'fort-worth-tx': parseLocality(
    fortWorthRaw,
    'data/localities/fort-worth-tx.json',
  ) as LocalityProfile,
  'colorado-springs-co': parseLocality(
    coloradoSpringsRaw,
    'data/localities/colorado-springs-co.json',
  ) as LocalityProfile,
  'charlotte-nc': parseLocality(
    charlotteRaw,
    'data/localities/charlotte-nc.json',
  ) as LocalityProfile,
  'tampa-fl': parseLocality(
    tampaRaw,
    'data/localities/tampa-fl.json',
  ) as LocalityProfile,
};

/**
 * Assembles the full property tax system for a locality by merging statewide
 * rules with local levies. Callers should use this rather than hand-building
 * the object, so state and local exemptions are never accidentally dropped.
 */
export function propertyTaxSystemFor(localityId: string): PropertyTaxSystem {
  const locality = LOCALITIES[localityId];
  if (!locality) throw new Error(`Unknown locality: ${localityId}`);

  const state = STATES[locality.state];
  if (!state) throw new Error(`Unknown state: ${locality.state}`);

  const framework = state.propertyFramework.value;

  return {
    assessment: framework.assessment,
    valueCap: framework.valueCap,
    exemptions: [
      ...framework.statewideExemptions,
      ...locality.localExemptions.value,
    ],
    levies: locality.propertyLevies.value,
    supplementalDistricts: locality.supplementalDistricts.value,
  };
}

export interface StaleField {
  scope: string;
  field: string;
  source: string;
  note?: string;
}

/**
 * Every rate nobody has confirmed. Surface these in the UI — an unverified
 * mill levy is the most likely reason a result is wrong.
 */
export function unverifiedFields(): StaleField[] {
  const out: StaleField[] = [];

  const scan = (scope: string, profile: Record<string, unknown>) => {
    for (const [field, val] of Object.entries(profile)) {
      if (!val || typeof val !== 'object' || !('verifiedOn' in val)) continue;
      const wrapped = val as {
        verifiedOn: string | null;
        source: string;
        note?: string;
      };
      if (wrapped.verifiedOn === null) {
        out.push({ scope, field, source: wrapped.source, note: wrapped.note });
      }
    }
  };

  for (const [code, s] of Object.entries(STATES)) {
    scan(code, s as unknown as Record<string, unknown>);
  }
  for (const [id, l] of Object.entries(LOCALITIES)) {
    scan(id, l as unknown as Record<string, unknown>);
  }
  return out;
}

/** Fields verified longer ago than `maxAgeDays`. Rates drift annually. */
export function staleFields(maxAgeDays = 365): StaleField[] {
  const out: StaleField[] = [];
  const cutoff = Date.now() - maxAgeDays * 86_400_000;

  const scan = (scope: string, profile: Record<string, unknown>) => {
    for (const [field, val] of Object.entries(profile)) {
      if (!val || typeof val !== 'object' || !('verifiedOn' in val)) continue;
      const wrapped = val as { verifiedOn: string | null; source: string };
      if (wrapped.verifiedOn && Date.parse(wrapped.verifiedOn) < cutoff) {
        out.push({ scope, field, source: wrapped.source });
      }
    }
  };

  for (const [code, s] of Object.entries(STATES)) {
    scan(code, s as unknown as Record<string, unknown>);
  }
  for (const [id, l] of Object.entries(LOCALITIES)) {
    scan(id, l as unknown as Record<string, unknown>);
  }
  return out;
}
