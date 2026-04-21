# Models Architecture

## Subject Memory and Meaning Development

- The app itself can be understood as a big subject, and each subject has its own memory instance.
- Memory is the developing meaning space of a subject.
- A `trace` is the first layer of memory.
- A trace is any data that comes to the subject through MOA.
- Examples of trace sources include local uploads, Telegram, and AI-generated incoming data.
- Messages received from other subjects are also traces, because they enter the receiving subject for the first time.
- Traces are unprocessed meaning material relative to the subject.

## Study Planner Position

- `studyPlanner` is not MOA.
- MOA provides incoming data to the subject; `studyPlanner` takes what MOA gives and organizes or processes it.
- Because of that, `studyPlanner` belongs to the meaning-developer side of the subject rather than the MOA side.
- `StudyPlanner` can exist as a shared sub-schema definition for all subjects.
- The actual meaning built through a study planner is still subject-specific.
- Different subjects can develop different or better meanings from similar traces.
