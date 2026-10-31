/**
 * Reads the Lambdas' SSM SecureString parameters through the AWS Parameters and Secrets Lambda
 * Extension. Node only (Lambda); the browser never imports it.
 *
 * @packageDocumentation
 */
export * from './extension-environment.ts';
export * from './parameter-reader.ts';
