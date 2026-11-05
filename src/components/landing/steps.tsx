import { useRef } from "react";
import { GLBackground } from "@/components/fx";
import { gsap, useScene } from "@/lib/gsap";
import { t } from "@/lib/i18n";
import { SplitHeading } from "./kit";
import { rise } from "./tweens";
import { useVenue } from "./util";

/**
 * How booking works, on paper.
 *
 * The one light section on a floodlit page, set like a printed programme: a loud three-word
 * heading on the left, the steps as ruled rows on the right. Copy stays readable throughout;
 * the rules briefly draw on entry without holding up the scroll.
 */
export function StepsScene() {
  const venue = useVenue();
  const root = useRef<HTMLElement>(null);
  const steps = [
    {
      n: "01",
      title: t("Pick your slot"),
      body: t("See which courts are free, hour by hour."),
      tag: t("Live grid"),
    },
    {
      n: "02",
      title: t("Hold it for {n} minutes", { n: venue.holdMinutes }),
      body: t("The slot is held for you. You do not pay yet."),
      tag: t("{n}-min hold", { n: venue.holdMinutes }),
    },
    {
      n: "03",
      title: t("Pay at the desk"),
      body: t("Pay for each court booking or class at reception by cash or bank transfer."),
      tag: t("Cash or transfer"),
    },
  ];

  useScene(root, ({ motion }) => {
    const el = root.current;
    if (!motion || !el) return;
    rise(el, "[data-rise]");
    const q = gsap.utils.selector(el);
    gsap.fromTo(q("[data-rule]"), { scaleX: 0 }, {
      scaleX: 1,
      duration: 0.55,
      stagger: 0.1,
      ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 80%", once: true },
    });
  });

  return (
    <section ref={root} id="how" className="relative scroll-mt-20 overflow-hidden bg-paper text-paper-ink">
      {/* Pointer-reactive dot field, pressed lightly into the paper like a print screen: small dots
          that barely swell, so the cursor leaves a trace and not ink blots. */}
      <GLBackground variant="dotgrid" color="#121410" gap={22} dot={0.9} radius={110} opacity={0.12} />
      <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 pb-14 pt-20 md:grid-cols-2 md:gap-16 md:pb-20 md:pt-24">
        <div>
          <p data-rise className="inline-block rounded-md bg-paper-ink px-2.5 py-1.5 font-mono text-2xs font-bold uppercase tracking-wider text-accent">
            {t("How to book a court")}
          </p>
          <h2 className="font-athletic mt-6 text-5xl leading-[0.95] sm:text-7xl">
            <SplitHeading text={t("Pick. Hold. Play.")} />
          </h2>
        </div>

        <ol className="self-end">
          {steps.map((s, i) => (
            <li key={s.n} data-step className="relative grid grid-cols-[3.5rem_1fr] items-start gap-x-4 gap-y-3 py-5 sm:grid-cols-[4.5rem_1fr_auto]">
              <span aria-hidden data-rule className="absolute inset-x-0 top-0 h-[1.5px] origin-left bg-paper-ink" />
              {i === steps.length - 1 ? (
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[1.5px] bg-paper-ink" />
              ) : null}
              <span data-num className="font-display text-3xl leading-none tabular-nums sm:text-4xl">
                {s.n}
              </span>
              <div>
                <h3 data-copy className="text-lg font-bold">
                  {s.title}
                </h3>
                <p data-copy className="mt-0.5 text-sm leading-relaxed text-paper-ink/65">
                  {s.body}
                </p>
              </div>
              <span
                data-tag
                className="col-start-2 justify-self-start rounded-md bg-paper-ink px-2 py-1 font-mono text-2xs font-bold uppercase tracking-wider text-accent sm:col-start-auto sm:mt-0.5 sm:justify-self-end"
              >
                {s.tag}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
