CREATE FUNCTION prevent_user_posix_identity_update() RETURNS trigger AS $$
BEGIN
  IF NEW.posix_uid IS DISTINCT FROM OLD.posix_uid
     OR NEW.posix_gid IS DISTINCT FROM OLD.posix_gid THEN
    RAISE EXCEPTION 'platform POSIX UID/GID are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER users_posix_identity_immutable
BEFORE UPDATE OF posix_uid, posix_gid ON users
FOR EACH ROW EXECUTE FUNCTION prevent_user_posix_identity_update();
