import { useState } from 'react'
import { useConfigurator } from '../store'

/**
 * "Describe Your Product" — first-class entry point above the stepper. Typing
 * intent pre-fills the parameters (deterministic keyword parser for 0.1; the
 * user is always steering an assembly, never facing a blank form).
 */
export function DescribeBox() {
  const applyDescription = useConfigurator((s) => s.applyDescription)
  const [text, setText] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  const apply = () => {
    if (!text.trim()) return
    const terms = applyDescription(text)
    setFeedback(
      terms.length > 0
        ? `Understood: ${terms.join(' · ')}`
        : 'No product terms recognized — try mentioning a fixture, arm, pole height, or finish.',
    )
  }

  return (
    <div className="describe">
      <label className="describe-label" htmlFor="describe-input">
        Describe Your Product
      </label>
      <div className="describe-row">
        <input
          id="describe-input"
          type="text"
          value={text}
          placeholder='e.g. "a pendant light on a 20 ft pole with shepherds hook arm in black"'
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
        />
        <button className="btn primary" onClick={apply}>
          Apply
        </button>
      </div>
      {feedback && <p className="describe-feedback">{feedback}</p>}
    </div>
  )
}
