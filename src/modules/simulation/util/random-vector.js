import { random, sqrt, cos, sin, PI, Vector } from '@benzed/math'

/******************************************************************************/
// Main
/******************************************************************************/

function randomVector (radius) {

  const angle = random(0, 2 * PI)
  const rRadiusSqr = random(radius ** 2)
  const rRadius = sqrt(rRadiusSqr)

  return new Vector(rRadius * cos(angle), rRadius * sin(angle))
}

/******************************************************************************/
// Exports
/******************************************************************************/

export default randomVector