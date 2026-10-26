/* Node loader hooks: map 'three' and 'three/addons/*' to local stubs so the
   full game can be exercised headlessly. */
const THREE_STUB = new URL('./three-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: THREE_STUB, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) {
    return { url: THREE_STUB, shortCircuit: true };
  }
  return next(specifier, context);
}
