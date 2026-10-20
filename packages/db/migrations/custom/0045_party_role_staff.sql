-- Staff appear in the address book when invited to the organization team.
ALTER TABLE party_roles DROP CONSTRAINT IF EXISTS party_roles_key_check;
ALTER TABLE party_roles ADD CONSTRAINT party_roles_key_check
  CHECK (
    role_key IN (
      'prospect',
      'tenant',
      'owner',
      'supplier',
      'partner',
      'government',
      'authorized_representative',
      'lawyer',
      'staff',
      'other'
    )
  );
