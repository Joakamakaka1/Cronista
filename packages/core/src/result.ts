/** A value or why there is none: how the domain reports failures, instead of throwing. */
export type Result<Value, Failure> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure };
