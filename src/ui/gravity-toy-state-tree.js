import { StateTree, state, action } from '@benzed/state-tree'
import { Simulation, Renderer } from '../simulation'
import { randomVector, orbitalVelocity } from '../simulation/util'

import { Vector, abs, round, clamp, random } from '@benzed/math'
import { copy, set, get } from '@benzed/immutable'

import { DEFAULT_RENDERING } from '../simulation/constants'
import { MAX_SPEED, DEFAULT_BODIES } from './constants'

/******************************************************************************/
// Data
/******************************************************************************/

const CONTEXT_INTERVAL = 150 // ms
const NUM_DELTA_TICKS = 30

const STAR_MASS = 1000000000

const $$mrs = Symbol('mutable-runtime-state')

/******************************************************************************/
// Helper
/******************************************************************************/

// I feel like I write this function a LOT. TODO add to @benzed/array?
const average = array => {

  let total = 0
  for (const value of array)
    total += value

  return total / array.length
}

/******************************************************************************/
// Setup
/******************************************************************************/

class DefaultSimulation extends Simulation {

  constructor () {

    super({ realBodiesMin: 256 })

    const center = new Vector(innerWidth / 2, innerHeight / 2)
    const bodies = []

    const { radius, speed, count, groups, MASS } = DEFAULT_BODIES

    const star = {
      mass: STAR_MASS,
      pos: new Vector(1920 * 1500, 0),
      vel: new Vector(0, 0)
    }

    bodies.push(star)

    const orbit = orbitalVelocity(center, star)

    for (let g = 0; g < groups; g++) {

      const groupCenter = center.add(randomVector(radius))
      const groupVel = randomVector(speed).add(orbit)

      for (let i = 0; i < count / groups; i++) {

        const pos = randomVector(radius * 0.5).iadd(groupCenter)
        const vel = randomVector(speed * 0.5).iadd(groupVel)

        let mass = random(MASS.min, MASS.max)
        if (random() < MASS.superSizeProbability)
          mass *= MASS.superSizeMassMultiplier

        bodies.push({
          mass,
          pos,
          vel: vel
        })
      }
    }

    this.createBodies(bodies)

  }
}

/******************************************************************************/
// Main
/******************************************************************************/

class GravityToyStateTree extends StateTree {

  @state
  time = {
    total: 0,
    delta: 0
  }

  @state
  targetSpeed = 1 // desired speed

  @state
  actualSpeed = 1

  @state
  paused = false

  @action('paused')
  setPaused = value => !!value

  @action('targetSpeed')
  setTargetSpeed = targetSpeed => targetSpeed:: round():: clamp(-MAX_SPEED, MAX_SPEED)

incrementTargetSpeed = (reverse = false) => {

  let { targetSpeed } = this
  const { paused } = this
  const { currentTick, firstTick, lastTick } = this.simulationState

  const isSameDir = reverse === (targetSpeed < 0)
  const isAtOne = abs(targetSpeed) === 1

  // if you're moving fast at the end of the simulation, we dont want to have
  // to press the reverse key a bunch of times
  if ((reverse && currentTick === lastTick) || (!reverse && currentTick === firstTick))
    targetSpeed = reverse ? -1 : 1

  // if we're incrementing speed while paused, we don't want to change the magnitude
  // only the direction

  else
    targetSpeed = isSameDir
      ? paused
        ? targetSpeed
        : targetSpeed * 2
      : isAtOne
        ? targetSpeed * -1
        : targetSpeed / 2

  this.setTargetSpeed(targetSpeed)
}

@state
renderOptions = copy(DEFAULT_RENDERING)

@state
simulationState = {
  firstTick: 0,
  lastTick: 0,
  currentTick: 0,
  running: false,
  usedCacheMemory: 0
}

renderer = null
simulation = null

_uiIntervalId = null
_renderIntervalId = null
_deltaTicks = []
_runOnUpdate = [];

[$$mrs] = {
  time: {
    total: 0,
    delta: 0
  },
  actualSpeed: 0,
  simulationState: {
    firstTick: 0,
    lastTick: 0,
    currentTick: 0,
    running: false,
    usedCacheMemory: 0,
    maxCacheMemory: 0
  }
}

start () {
  this.simulation.run()

  this._renderIntervalId = requestAnimationFrame(this.updateRender)
  this._uiIntervalId = setInterval(this.updateUi, CONTEXT_INTERVAL)
}

end () {
  this.simulation.stop()
  cancelAnimationFrame(this.renderIntervalId)
  clearInterval(this.uiIntervalId)
}

// update the state tree by copying the mutable runtime state
@action
updateUi = () => {
  return { ...this.state, ...this[$$mrs] }
}

// update the render visible on the canvas
updateRender = timeTotal => {

  const { renderer, simulation, paused, [$$mrs]: mrs } = this

  const initialTick = simulation.currentTick
  const nextTick = initialTick + (paused ? 0 : this.targetSpeed)

  simulation.setCurrentTick(nextTick)
  renderer.render(simulation)

  // fill deltatick array
  const deltaTick = simulation.currentTick - initialTick
  this._deltaTicks.push(deltaTick)
  while (this._deltaTicks.length > NUM_DELTA_TICKS)
    this._deltaTicks.shift()
  const averageDeltaTick = average(this._deltaTicks)

  // update mutable runtime state
  mrs.time.delta = timeTotal - mrs.time.total
  mrs.time.total = timeTotal
  for (const key in mrs.simulationState)
    mrs.simulationState[key] = simulation[key]

  // if deltaTick === this.targetSpeed, playback is most likely normalized.
  // it's more accurate to return the targetSpeed rather than calculating
  // the average of all past deltaTicks, this way there will not be a lag
  // in the ui as the _deltaTicks array fills up.
  mrs.actualSpeed = deltaTick === this.targetSpeed && abs(this.targetSpeed) !== 1
    ? deltaTick
    : averageDeltaTick

  // set renderer speed, pretty much only effects body speed distortion. I
  // realize this is applying the render speed of the previous frame to the next
  // but at 60 frames per second, the error isn't noticable.
  const isStrugglingWithLargeSimulation = !paused &&
    this.targetSpeed > 0 &&
    averageDeltaTick < 1 &&
    averageDeltaTick > 0

  // setting to 1 looks nicer if the integrator is going slow
  this.renderer.speed = isStrugglingWithLargeSimulation
    ? 1
    : deltaTick

  // run update actions
  for (const onUpdate of this._runOnUpdate)
    onUpdate(mrs, this)

  // queue next frame
  requestAnimationFrame(this.updateRender)
}

constructor (...args) {
  super(...args)

  this.simulation = new DefaultSimulation()
  this.renderer = new Renderer()

  // Sync options in renderer with options in state
  this.subscribe((toy, listenPath, changePath) => {
    const equivalentChangePath = changePath.slice(1)
    const equivalentValue = get.mut(toy, changePath)

    set.mut(toy.renderer.options, equivalentChangePath, equivalentValue)
  }, 'renderOptions')

  // Center camera on largest body TODO this should go elsewhere
  const largest = [...this.simulation.bodies()].reduce((big, body) => big.mass > body.mass && big.mass !== STAR_MASS
    ? big
    : body, { mass: -Infinity })

  this.renderer.camera.referenceFrame = largest
  this.renderer.camera.target.pos.set(Vector.zero)
}
}

/******************************************************************************/
// Exports
/******************************************************************************/

export default GravityToyStateTree
