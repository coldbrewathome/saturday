// First-run family profile wizard — two quick screens (ages+ZIP, then
// interests+budget+setting) that seed the personalized feed. Shown once per
// browser (until a profile exists), re-openable via "Edit profile". Kids app
// only: the adults app personalizes differently (going-out mode).

import { useState } from "react";
import { ArrowLeft, Check, ChevronRight, Sparkles } from "lucide-react";
import type { AgeBand, PlannerBudgetLevel, PlannerSettingPreference } from "./planner";
import { EVENT_THEMES } from "./eventThemes";
import type { FamilyProfile } from "./familyProfile";

const AGE_CHIPS: ReadonlyArray<readonly [AgeBand, string]> = [
  ["toddler", "0–2"],
  ["preschool", "3–5"],
  ["school-age", "6–10"],
  ["tween", "10+"],
];

const BUDGET_OPTIONS: ReadonlyArray<readonly [PlannerBudgetLevel, string]> = [
  ["any", "Any"],
  ["free", "Free"],
  ["under-25", "Under $25"],
];

const SETTING_OPTIONS: ReadonlyArray<readonly [PlannerSettingPreference, string]> = [
  ["any", "Either"],
  ["indoor", "Indoor"],
  ["outdoor", "Outdoor"],
];

type Props = {
  onComplete: (profile: FamilyProfile) => void;
  onDismiss: () => void;
};

export default function OnboardingWizard({ onComplete, onDismiss }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [ageBands, setAgeBands] = useState<AgeBand[]>([]);
  const [zipCode, setZipCode] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [budget, setBudget] = useState<PlannerBudgetLevel>("any");
  const [setting, setSetting] = useState<PlannerSettingPreference>("any");

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  function finish() {
    onComplete({
      ageBands,
      zipCode: zipCode.trim(),
      interests,
      budget,
      setting,
    });
  }

  return (
    <div className="modal-backdrop profile-wizard-backdrop" role="dialog" aria-modal="true" aria-label="Personalize your weekend">
      <div className="profile-wizard-card">
        <button
          type="button"
          className="profile-wizard-skip"
          onClick={onDismiss}
          aria-label="Skip personalization"
        >
          Skip for now
        </button>

        {step === 1 ? (
          <section className="profile-wizard-step">
            <p className="eyebrow">Step 1 of 2</p>
            <h2>Who's in your family?</h2>
            <p className="profile-wizard-hint">
              We'll rank the weekend around their ages. Pick every age that applies.
            </p>

            <div className="segmented profile-wizard-chips" role="group" aria-label="Kids' ages">
              {AGE_CHIPS.map(([band, label]) => (
                <button
                  key={band}
                  type="button"
                  className={ageBands.includes(band) ? "active" : ""}
                  aria-pressed={ageBands.includes(band)}
                  onClick={() => setAgeBands((list) => toggle(list, band))}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="profile-wizard-field" htmlFor="profile-zip">
              <span>Your ZIP (for near-you picks)</span>
              <input
                id="profile-zip"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={10}
                placeholder="e.g. 94110"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value.replace(/[^\d-]/g, ""))}
              />
            </label>

            <div className="profile-wizard-actions">
              <button
                type="button"
                className="primary-button wide"
                onClick={() => setStep(2)}
              >
                Continue <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : (
          <section className="profile-wizard-step">
            <p className="eyebrow">Step 2 of 2</p>
            <h2>What makes it a good weekend?</h2>
            <p className="profile-wizard-hint">
              Pick interests, your budget, and indoor vs outdoor — we'll use
              these to surface the best matches.
            </p>

            <div className="segmented profile-wizard-chips profile-wizard-themes" role="group" aria-label="Interests">
              {EVENT_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={interests.includes(theme.id) ? "active" : ""}
                  aria-pressed={interests.includes(theme.id)}
                  onClick={() => setInterests((list) => toggle(list, theme.id))}
                >
                  {interests.includes(theme.id) && (
                    <Check size={12} aria-hidden="true" />
                  )}
                  {theme.label}
                </button>
              ))}
            </div>

            <div className="profile-wizard-row">
              <div>
                <span className="profile-wizard-row-label">Budget</span>
                <div className="segmented compact" role="group" aria-label="Budget">
                  {BUDGET_OPTIONS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={budget === id ? "active" : ""}
                      aria-pressed={budget === id}
                      onClick={() => setBudget(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="profile-wizard-row-label">Indoor / outdoor</span>
                <div className="segmented compact" role="group" aria-label="Indoor or outdoor">
                  {SETTING_OPTIONS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={setting === id ? "active" : ""}
                      aria-pressed={setting === id}
                      onClick={() => setSetting(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="profile-wizard-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => setStep(1)}
              >
                <ArrowLeft size={14} aria-hidden="true" /> Back
              </button>
              <button type="button" className="primary-button wide" onClick={finish}>
                <Sparkles size={15} aria-hidden="true" /> Show me my weekend
              </button>
            </div>
          </section>
        )}

        <div className="profile-wizard-dots" aria-hidden="true">
          <span className={step === 1 ? "active" : ""} />
          <span className={step === 2 ? "active" : ""} />
        </div>
      </div>
    </div>
  );
}
