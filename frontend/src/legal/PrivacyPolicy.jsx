/**
 * The privacy policy.
 *
 * Every factual claim here was checked against the code before it was written,
 * because a privacy policy that overstates protection is worse than none at
 * all: it invites a patient to disclose something on a promise the software
 * does not keep. Where a claim is enforced by a test, it says so, since that is
 * the difference between a promise and a setting somebody could change.
 *
 * If the behaviour below changes, this file changes with it in the same commit.
 */

export default function PrivacyPolicy() {
  return (
    <article className="legal">
      <header className="legal__header">
        <h2 className="legal__title">Privacy Policy</h2>
        <p className="legal__updated">Last updated 15 September 2026</p>
      </header>

      <section className="legal__summary" aria-labelledby="privacy-summary">
        <h3 id="privacy-summary" className="legal__summary-title">
          The short version
        </h3>
        <ul className="legal__summary-list">
          <li>
            We never ask for your name, your patient number, your age or your
            diagnosis. There is nowhere in this app to enter them.
          </li>
          <li>
            The record of your consultation stays on the device you used. It is
            never sent to us, because there is no address to send it to.
          </li>
          <li>
            A prescription we store holds medicine names, photographs of the
            medicines and dosage instructions. Nothing in it says who it belongs
            to.
          </li>
          <li>
            No advertising, no analytics and no tracking of any kind. The
            patient screens set no cookies at all.
          </li>
        </ul>
      </section>

      <section>
        <h3>Who is responsible</h3>
        <p>
          Tie Me Ghana is built and run by the Tie Me Ghana team. It was created
          for the MTN Ghana Tekyerema Pa Hackathon 2026.
        </p>
        <p>
          <strong>This is a pilot and it is not yet in clinical use.</strong> It
          is offered for demonstration and supervised testing. Do not rely on it
          for a decision about anyone&rsquo;s treatment.
        </p>
        <p>
          For anything in this policy, write to{" "}
          <a href="mailto:bestdrtrick@gmail.com">bestdrtrick@gmail.com</a>.
        </p>
      </section>

      <section>
        <h3>What stays on the device and never reaches us</h3>
        <p>
          Four things are written into your browser&rsquo;s own storage on the
          device in front of you. None of them travel anywhere.
        </p>
        <dl className="legal__terms">
          <dt>The record of the visit</dt>
          <dd>
            Every question the clinician asked and every answer given, with who
            said it and when. This is the one piece of genuinely sensitive
            information the app handles, because consultations cover pregnancy,
            sexually transmitted infections and HIV status.
          </dd>

          <dt>How the visit is set up</dt>
          <dd>
            Whether you told us you read written language, and which language
            answers are read aloud in.
          </dd>

          <dt>The question currently on screen</dt>
          <dd>
            Kept so that reloading the page does not lose the question you were
            part way through answering.
          </dd>

          <dt>The reference of the last prescription issued</dt>
          <dd>
            The random code itself, so the screen can be reopened. Not the
            medicines.
          </dd>
        </dl>
        <p>
          The record of the visit is <strong>never transmitted</strong>. That is
          not a setting we chose and could change by accident. Our server has no
          address that accepts one, and a test walks every route in the system
          and fails the build if one ever appears.
        </p>
        <p>
          It is <strong>deleted when the visit ends</strong>. This app runs on a
          device that hospital staff hand from one patient to the next, and a
          record that outlived its visit would show the next patient the
          previous patient&rsquo;s consultation. Clearing your browser data
          removes everything listed above immediately.
        </p>
        <p>
          Sign language videos are also saved in the browser cache so they play
          without a connection. They are the same clips everyone sees and say
          nothing about you.
        </p>
      </section>

      <section>
        <h3>What we do store on our servers</h3>

        <h4>Prescriptions</h4>
        <p>When a clinician issues a prescription, we store:</p>
        <ul>
          <li>A random reference of sixteen bytes, used by the QR code.</li>
          <li>The date and time it was created.</li>
          <li>
            For each medicine: its name if one was typed, a photograph of it if
            one was taken, how much to take, how often, and the sentence shown
            to the patient.
          </li>
        </ul>
        <p>
          There is <strong>no field for a patient</strong> in that record. Not
          one left blank, not one hidden from the screen. The record has no
          space to hold a name, so a prescription cannot be linked back to a
          person by us, by the hospital or by anyone who obtains the reference.
        </p>

        <h4>Photographs of medicines</h4>
        <p>
          A photograph taken on a phone normally carries hidden information
          alongside the picture, including the GPS coordinates of where it was
          taken, the make and model of the phone and the exact time. Every
          photograph uploaded here is decoded and written out again pixel by
          pixel, which removes all of it. What we keep is the picture and
          nothing else.
        </p>
        <p>
          Photograph the medicine, not the patient, and not a label with
          somebody&rsquo;s name printed on it.
        </p>

        <h4>The sign language library</h4>
        <p>
          The videos themselves, the English word each one stands for, and the
          name of the sign language consultant who approved it. This is the
          app&rsquo;s vocabulary. It is not about any patient.
        </p>

        <h4>Staff accounts</h4>
        <p>
          Clinicians and sign language consultants who review the video library
          have an account holding a username, an email address and a password
          that is stored scrambled rather than readable. Patients do not have
          accounts and are never asked to create one.
        </p>
      </section>

      <section>
        <h3>What we send to other companies</h3>

        <h4>Translation and speech</h4>
        <p>
          When the full service is switched on, three things are sent to
          GhanaNLP, a Ghanaian language technology provider, through its Khaya
          service:
        </p>
        <ul>
          <li>
            The clinician&rsquo;s voice recording, so it can be turned into
            text.
          </li>
          <li>Text, so it can be translated between English and Twi.</li>
          <li>Text, so it can be read aloud.</li>
        </ul>
        <p>
          We do not keep the recording. It exists in our server&rsquo;s memory
          only for as long as the request takes, and is never written to a disk
          or a database.
        </p>
        <p>
          <strong>
            In the current pilot this is switched off entirely.
          </strong>{" "}
          The app runs a stand in that performs no translation, so no recording
          and no text leaves our servers. You can tell because the screen
          labels captions as untranslated and spoken answers as silent rather
          than pretending otherwise.
        </p>

        <h4>Where the app runs</h4>
        <p>
          Netlify serves the app itself. Render runs the server. Neon holds the
          database. Cloudflare stores the videos and the medicine photographs.
          The database and the stored files are located in the United States,
          which means the limited information described above is held outside
          Ghana.
        </p>
        <p>
          These companies can see the technical details any internet service
          sees, such as the address your connection comes from. We do not
          combine that with anything else, and we do not have it in a form that
          points at a person.
        </p>
      </section>

      <section>
        <h3>Cookies and tracking</h3>
        <p>
          The patient facing part of this app sets{" "}
          <strong>no cookies whatsoever</strong>. There is no analytics service,
          no advertising network, no social media button and no third party
          script of any kind. Nobody is measuring what you tap.
        </p>
        <p>
          The separate staff login screen sets one cookie, a security token that
          prevents a malicious site from submitting a form on a signed in
          member&rsquo;s behalf. It carries no identity and it is not used for
          tracking.
        </p>
      </section>

      <section>
        <h3>How long we keep things</h3>
        <p>
          <strong>Prescriptions are kept indefinitely</strong>, and that is
          deliberate. A course of treatment can run for months, and a
          prescription that stopped playing while the patient was still taking
          the medicine would be a harm in itself. Because the record identifies
          nobody, keeping it costs nobody their privacy.
        </p>
        <p>
          If you want a prescription removed, send us its reference and we will
          delete it. We cannot find it any other way, since we have nothing else
          to search by.
        </p>
        <p>
          Everything on the device is deleted when the visit ends, or whenever
          you clear your browser data.
        </p>
      </section>

      <section>
        <h3>Your rights</h3>
        <p>
          Ghana&rsquo;s Data Protection Act, 2012, Act 843, gives you the right
          to ask what personal information is held about you, to have it
          corrected, to ask for it to be deleted and to complain to the Data
          Protection Commission.
        </p>
        <p>
          In practice, we expect to answer most requests by explaining that we
          hold nothing that identifies you. If you have a prescription
          reference, that is the one thing we can look up, and we will tell you
          what it contains or delete it on request.
        </p>
      </section>

      <section>
        <h3>Children</h3>
        <p>
          Children are treated exactly as adults are here, because the app
          collects nothing from either. A parent or guardian should be present
          for a child&rsquo;s consultation as they would be without this app.
        </p>
      </section>

      <section>
        <h3>Changes to this policy</h3>
        <p>
          If what the app does with information changes, this page changes in
          the same update. The date at the top tells you when it last did.
        </p>
      </section>

      <section>
        <h3>Contact</h3>
        <p>
          Questions, corrections, deletion requests and complaints all go to{" "}
          <a href="mailto:bestdrtrick@gmail.com">bestdrtrick@gmail.com</a>.
        </p>
      </section>
    </article>
  );
}
