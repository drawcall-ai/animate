/** A condition a story waits on. */
export type Wait = () => boolean

/** A story is a generator: statements take effect at once, and each `yield` hands back a wait the story goes on after. */
export type Story = Generator<Wait, void, void>

export class Teller {
  private story: Story | null = null
  private wait: Wait | null = null

  tell(story: Story) {
    this.story = story
    this.wait = null
  }

  get telling() {
    return this.story !== null
  }

  /** runs the story on until it reaches a wait that does not yet hold */
  advance() {
    while (this.story) {
      if (this.wait && !this.wait()) return
      const next = this.story.next()
      if (next.done) {
        this.story = null
        return
      }
      this.wait = next.value
    }
  }
}
