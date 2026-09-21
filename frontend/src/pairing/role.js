/**
 * Whether this device is the doctor's, remembered, and nothing else.
 *
 * The app opens by asking who is holding it, because the patient's own phone
 * and the doctor's device open the very same address and the patient has no
 * other way to find where to type a pairing code. See ADR 053.
 *
 * Only "doctor" is stored. A hospital device stays a doctor's device from one
 * patient to the next, and asking every time would put a tap in front of every
 * visit for nothing. The patient's answer is the address it leads to, `/join`,
 * which a reload keeps by itself, so there is nothing to remember. It is also
 * never cleared by "New patient": that ends a visit, not the device's job.
 *
 * Unlike the visit and the device choice it does not expire. It says what the
 * device is for, not what is happening on it, and holds nothing about a
 * patient.
 */

const STORAGE_KEY = "tiemeghana.role";

export const Role = {
  DOCTOR: "doctor",
  PATIENT: "patient",
};

/** `Role.DOCTOR` if this device has been chosen as one, otherwise null. */
export function loadRole() {
  try {
    return localStorage.getItem(STORAGE_KEY) === Role.DOCTOR ? Role.DOCTOR : null;
  } catch {
    return null;
  }
}

/** Remember this device as the doctor's. Returns the role for state. */
export function saveDoctorRole() {
  try {
    localStorage.setItem(STORAGE_KEY, Role.DOCTOR);
  } catch {
    // Private mode or a full disk. It applies for this page load through
    // state; the question is simply asked again after a reload.
  }
  return Role.DOCTOR;
}

export function clearRole() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove from.
  }
}
