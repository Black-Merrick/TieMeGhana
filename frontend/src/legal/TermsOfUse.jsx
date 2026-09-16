/**
 * The terms of use.
 *
 * Written to be read by a clinician who is about to rely on this in front of a
 * patient, so the limits come first and the legal protection comes last. The
 * order is deliberate: the sentence that matters most is the one saying this is
 * not an interpreter, and burying it under a liability clause would be a way of
 * publishing it without anybody reading it.
 */

export default function TermsOfUse() {
  return (
    <article className="legal">
      <header className="legal__header">
        <h2 className="legal__title">Terms of Use</h2>
        <p className="legal__updated">Last updated 16 September 2026</p>
      </header>

      <section className="legal__summary" aria-labelledby="terms-summary">
        <h3 id="terms-summary" className="legal__summary-title">
          Before you rely on this
        </h3>
        <ul className="legal__summary-list">
          <li>
            This is a communication aid. It is not a qualified sign language
            interpreter and it does not replace one.
          </li>
          <li>
            It is a pilot. It has not been approved as a medical device and it
            is not cleared for clinical use.
          </li>
          <li>
            It refuses rather than guesses. When a word cannot be signed
            accurately, it says so instead of showing something close.
          </li>
          <li>
            Translation between English and Twi is done by machine, not by a
            person, and the sentences pass through a third party service.
          </li>
          <li>
            Anyone holding a prescription QR code can see that medicine list.
            Treat the code as private.
          </li>
        </ul>
      </section>

      <section>
        <h3>What this app is</h3>
        <p>
          Tie Me Ghana helps a clinician and a Deaf or Hard of Hearing patient
          understand one another during a hospital visit. It shows questions in
          Ghanaian Sign Language video, lets the patient answer by tapping,
          typing or pointing, and reads those answers aloud so the clinician can
          keep their hands and eyes on the patient.
        </p>
        <p>
          It is provided by the Tie Me Ghana team, free of charge, and it was
          built for the MTN Ghana Tekyerema Pa Hackathon 2026.
        </p>
      </section>

      <section>
        <h3>What this app is not</h3>
        <p>
          <strong>It is not an interpreter.</strong> A qualified Ghanaian Sign
          Language interpreter understands context, asks for clarification and
          is accountable for the accuracy of what they convey. This app does
          none of those things. Where an interpreter is available and the
          conversation matters, use the interpreter.
        </p>
        <p>
          <strong>It is not a medical device</strong> and it has not been
          assessed or approved by any regulator. It must not be used as the
          basis of a diagnosis or a treatment decision.
        </p>
        <p>
          <strong>It is not a medical record.</strong> The record of a visit is
          deleted when that visit ends. Write anything clinically important into
          the hospital&rsquo;s own records as you normally would.
        </p>
      </section>

      <section>
        <h3>How the sign language works, and where it stops</h3>
        <p>
          Every sign you see is a video of a real person signing, recorded in
          advance and approved by a fluent Ghanaian Sign Language consultant.
          The app never invents or animates a sign. It can only show what has
          been filmed and approved.
        </p>
        <p>This has a consequence worth understanding before you rely on it:</p>
        <ul>
          <li>
            When a word has no approved sign, the app tells you rather than
            substituting a different one. A near miss in a clinical sentence is
            more dangerous than a gap, because it looks like an answer.
          </li>
          <li>
            Some sentences are refused outright and will not be shown to the
            patient. When that happens, rephrase or find another way to ask.
          </li>
          <li>
            Words are spelled out letter by letter as a fallback. Spelling is
            slower and harder to follow, and not every patient reads fingerspelling
            fluently.
          </li>
        </ul>
        <p>
          <strong>Translation between English and Twi is machine translation.</strong>{" "}
          It is performed by GhanaNLP&rsquo;s Khaya service, it is good, and it
          is not a person. It has no knowledge of the patient, the diagnosis or
          anything said a moment earlier, and a clinical sentence is exactly the
          kind it can get subtly wrong. Read the Twi caption before you send it
          if you read Twi, and treat what comes back the way you would treat
          any translation nobody in the room has checked.
        </p>
      </section>

      <section>
        <h3>If you are a clinician using this</h3>
        <p>You agree to the following, and they are not formalities.</p>
        <ul>
          <li>
            <strong>Confirm that you have been understood.</strong> A tapped
            answer means the patient tapped something. It does not prove they
            understood the question.
          </li>
          <li>
            <strong>
              Do not use this app alone to take consent for a procedure
            </strong>
            , to deliver a serious diagnosis, or for any exchange where a
            misunderstanding carries real risk. Those need an interpreter.
          </li>
          <li>
            <strong>Read the caption before you send it.</strong> You are
            responsible for what reaches the patient.
          </li>
          <li>
            <strong>End the visit when you are finished.</strong> That is what
            deletes the record from the device before it is handed to the next
            patient.
          </li>
          <li>
            Photograph the medicine, never the patient, and never a label
            carrying somebody&rsquo;s name.
          </li>
        </ul>
      </section>

      <section>
        <h3>Prescriptions and QR codes</h3>
        <p>
          A prescription is reached by a long random code, and that code is the
          only thing protecting it. Anybody who scans the QR code or has the
          link can see that list of medicines and dosages. Nobody can guess one.
        </p>
        <p>
          The list carries no name, so it says what somebody is taking without
          saying who. Even so, treat a printed QR code the way you would treat
          any prescription slip.
        </p>
        <p>
          The medicines and dosages are what the clinician entered. The app does
          not check them, does not know about interactions and does not know
          anything about the patient. Getting them right is the
          prescriber&rsquo;s responsibility, exactly as on paper.
        </p>
      </section>

      <section>
        <h3>Availability</h3>
        <p>
          This pilot runs on free hosting. The server sleeps when nobody has
          used it recently and takes up to a minute to wake, and the service can
          be slow, interrupted or unavailable without notice. Do not build a
          clinic workflow that fails when this app does.
        </p>
        <p>
          Sign videos are saved on the device so they keep playing without a
          connection. Issuing a new prescription needs the server.
        </p>
      </section>

      <section>
        <h3>Acceptable use</h3>
        <p>Do not use this app to:</p>
        <ul>
          <li>
            Enter a patient&rsquo;s name, identity number, diagnosis or any
            other personal detail into a prescription. There is no field for it,
            and typing it into a medicine name defeats the protection the whole
            design rests on.
          </li>
          <li>
            Attempt to reach prescriptions belonging to other people, or to
            generate references you were not given.
          </li>
          <li>
            Copy the sign language videos for other purposes. They are
            recordings of real signers who agreed to appear in this app.
          </li>
          <li>Interfere with the service or the people using it.</li>
        </ul>
      </section>

      <section>
        <h3>The videos</h3>
        <p>
          The Ghanaian Sign Language recordings belong to the people who signed
          them and to the consultants who reviewed them. They are shown here for
          use inside this app. Ask us before using them anywhere else.
        </p>
      </section>

      <section>
        <h3>No warranty</h3>
        <p>
          This app is provided as it is, with no promise that it is accurate,
          available or fit for any particular purpose. That is a plain statement
          of fact for a pilot rather than a way of avoiding responsibility: the
          sign vocabulary is incomplete, translation is done by machine, and
          the hosting is free.
        </p>
        <p>
          To the extent the law allows, the Tie Me Ghana team is not liable for
          loss or harm arising from use of this app. Nothing here limits
          liability for anything that cannot lawfully be limited, and nothing
          here reduces a clinician&rsquo;s own professional duty to their
          patient.
        </p>
      </section>

      <section>
        <h3>Privacy</h3>
        <p>
          What the app does with information is set out in the Privacy Policy,
          which forms part of these terms.
        </p>
      </section>

      <section>
        <h3>Changes, and the law that applies</h3>
        <p>
          These terms may change as the app develops, and the date at the top
          says when they last did. They are governed by the laws of Ghana.
        </p>
      </section>

      <section>
        <h3>Contact</h3>
        <p>
          Write to{" "}
          <a href="mailto:bestdrtrick@gmail.com">bestdrtrick@gmail.com</a>.
        </p>
      </section>
    </article>
  );
}
