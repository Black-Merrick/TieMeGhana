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
        <p className="legal__updated">Last updated 16 September 2026</p>
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
          <li>
            Sentences are sent to a translation service to be turned into Twi
            and read aloud. Nothing identifying goes with them, and the record
            of the visit is not among them.
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

        <h4>Connecting a patient&rsquo;s own phone</h4>
        <p>
          When a clinician pairs a patient&rsquo;s own phone to the
          clinician&rsquo;s device, our server briefly holds three things: a
          six character code, and one connection description from each of the
          two devices. A connection description is technical data that says how
          to reach that device over the internet. It is the address of the
          device, not anything that was said.
        </p>
        <p>
          They are kept in memory only, never written to a database or a file,
          and discarded the moment the two devices have connected, or after ten
          minutes if they never do. The code is part of the address each device
          asks for, so, like any web address, it can appear in the
          server&rsquo;s ordinary request records; the connection descriptions
          travel in the body of the request and are not recorded.{" "}
          <strong>
            The consultation itself does not pass through our server when two
            devices are used.
          </strong>{" "}
          Once connected, the two devices talk to each other directly, and the
          record of the visit is kept on each device separately. The
          clinician&rsquo;s copy is deleted when the visit ends, as above. The
          patient&rsquo;s phone is their own, so its copy stays until they
          delete it, which they can do from the screen shown after the visit
          ends.
        </p>

        <p>
          So that reloading a page does not end the visit, the doctor&rsquo;s
          device also makes a second, long random code once the two have
          connected and gives it to the phone over their own connection. The
          server holds that code, in memory only, for up to four hours, the
          length of a visit, so the two can find each other again. It is
          discarded the moment the doctor ends the visit, and the server then
          only remembers that the visit ended, so a phone that was out of
          reach at the time is told when it returns. It identifies no person, it is
          kept on the two devices and nowhere else, and it opens nothing but
          that reconnection:
          what is said in the visit still never reaches the server.
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
          <strong>
            This is switched on. Some of what is said in the consultation
            leaves our servers.
          </strong>{" "}
          Three things are sent to GhanaNLP, a Ghanaian language technology
          provider, through its Khaya service:
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
          What is sent is the sentence itself and nothing around it. There is
          no name attached, no patient number and no identifier of any kind,
          because the app holds none to attach. GhanaNLP receives a clinical
          phrase with nothing to say whose it is.
        </p>
        <p>
          <strong>What this means in practice.</strong> A consultation conducted
          through this app involves a third party processing the words of it.
          That is the cost of translation working at all, and it is stated here
          rather than buried, so a hospital can weigh it before deciding to use
          the app and a patient can be told before it is used on them.
        </p>
        <p>
          The one thing that never leaves is the record of the visit. Questions
          and answers are assembled and kept on the device, and the sentences
          sent for translation are not gathered anywhere as a conversation.
        </p>

        <h4>Connecting two devices directly</h4>
        <p>
          To connect a clinician&rsquo;s device to a patient&rsquo;s own phone,
          each device asks a public Google server what its own internet address
          looks like from outside (a STUN server). That request contains no
          consultation, no name and no identifier from this app. Google can see
          the public address of each device that asks, the same as any website
          it is connected to can.
        </p>
        <p>
          Nothing that is said, shown or answered during the visit is sent to
          Google. If the two devices cannot reach each other directly, for
          example on some networks, the connection fails and the app says so.
          It does not fall back to sending the consultation through a server.
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
