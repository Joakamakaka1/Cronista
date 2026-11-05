/**
 * The game engine: the rules of a game day over the store, the narrator and the bible. The Lambdas
 * and the local command call this same interface. It has no AWS dependency, and errors are values.
 *
 * @remarks
 * Reading a bible is exported apart, as `@cronista/engine/bible`, so that a Lambda that never reads one
 * does not bundle its parser.
 *
 * @packageDocumentation
 */
export * from './alerts.ts';
export * from './check-spend.ts';
export * from './close-day.ts';
export * from './create-season.ts';
export type { BibleResult, LoadBible } from './load-bible.ts';
export * from './memory.ts';
export * from './open-day.ts';
export * from './request-hint.ts';
export * from './store.ts';
export * from './submit-action.ts';
