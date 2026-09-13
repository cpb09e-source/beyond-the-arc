// A separate, import-free file on purpose: a wildcard module declaration inside
// a file that has imports or exports is read as an augmentation, which may not
// use a wildcard.
declare module "*.svg" {
  const src: string;
  export default src;
}
