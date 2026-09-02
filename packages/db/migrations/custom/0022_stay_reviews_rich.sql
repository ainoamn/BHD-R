-- Stay reviews: Booking-style pros/cons + category scores for smart property rating.
ALTER TABLE stay_reviews
  ADD COLUMN IF NOT EXISTS title varchar(200),
  ADD COLUMN IF NOT EXISTS pros_text text,
  ADD COLUMN IF NOT EXISTS cons_text text,
  ADD COLUMN IF NOT EXISTS cleanliness integer,
  ADD COLUMN IF NOT EXISTS location_score integer,
  ADD COLUMN IF NOT EXISTS value_score integer,
  ADD COLUMN IF NOT EXISTS communication integer,
  ADD COLUMN IF NOT EXISTS accuracy integer,
  ADD COLUMN IF NOT EXISTS check_in_score integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_reviews_cleanliness_check'
  ) THEN
    ALTER TABLE stay_reviews
      ADD CONSTRAINT stay_reviews_cleanliness_check
      CHECK (cleanliness IS NULL OR (cleanliness >= 1 AND cleanliness <= 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_reviews_location_score_check'
  ) THEN
    ALTER TABLE stay_reviews
      ADD CONSTRAINT stay_reviews_location_score_check
      CHECK (location_score IS NULL OR (location_score >= 1 AND location_score <= 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_reviews_value_score_check'
  ) THEN
    ALTER TABLE stay_reviews
      ADD CONSTRAINT stay_reviews_value_score_check
      CHECK (value_score IS NULL OR (value_score >= 1 AND value_score <= 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_reviews_communication_check'
  ) THEN
    ALTER TABLE stay_reviews
      ADD CONSTRAINT stay_reviews_communication_check
      CHECK (communication IS NULL OR (communication >= 1 AND communication <= 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_reviews_accuracy_check'
  ) THEN
    ALTER TABLE stay_reviews
      ADD CONSTRAINT stay_reviews_accuracy_check
      CHECK (accuracy IS NULL OR (accuracy >= 1 AND accuracy <= 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stay_reviews_check_in_score_check'
  ) THEN
    ALTER TABLE stay_reviews
      ADD CONSTRAINT stay_reviews_check_in_score_check
      CHECK (check_in_score IS NULL OR (check_in_score >= 1 AND check_in_score <= 5));
  END IF;
END $$;
