/** Namespace of the custom metrics that tell whether the day opens and closes. */
export const GAME_LOOP_METRIC_NAMESPACE = 'Cronista/GameLoop';

/** Counts a job with a deadline that finished its work, by {@link JOB_DIMENSION}. */
export const JOB_COMPLETED_METRIC = 'JobCompleted';

/** The job of a {@link JOB_COMPLETED_METRIC} data point: `open-day` or `close-day`. */
export const JOB_DIMENSION = 'Job';

/**
 * Counts each time the owner could not be told something: an alert that did not go out, or a spend
 * check that did not run. A job carries on regardless, so nothing else would notice.
 */
export const OWNER_NOT_TOLD_METRIC = 'OwnerNotTold';

/**
 * Counts each push that did not reach a player: one the game could not queue, or one a push service
 * refused. The action or the job carries on, and the message is not retried, so nothing else would
 * notice.
 */
export const PUSH_NOT_DELIVERED_METRIC = 'PushNotDelivered';

/** Counts each finished check of a deadline, so an alarm notices when the checks stop. */
export const DEADLINE_CHECKED_METRIC = 'DeadlineChecked';
