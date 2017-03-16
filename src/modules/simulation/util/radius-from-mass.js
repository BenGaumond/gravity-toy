import { cbrt } from 'math-plus'

import { MASS_MIN } from '../body'

const RADIUS_MIN = 0.5 //pixels

const RADIUS_FACTOR = 0.2

export default function radiusFromMass(...args) {

  //why?
  //So that this function can be attached to an object that has mass
  //and used as a getter
  const mass = isFinite(args[0]) ? args[0] : this ? this.mass : MASS_MIN

  return RADIUS_MIN + cbrt(mass - MASS_MIN) * RADIUS_FACTOR

}
