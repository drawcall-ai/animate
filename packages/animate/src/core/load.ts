/** Tuned animation law: square-root growth gives gradual slowing for hand loads without
 * the linear law's excessive slowdown at large masses. Count each item once. */
export const loadFactor = (mass: number) => Math.sqrt(1 + mass / 10);
