-- The rectangular parametric roofs (gable/hip/shed) aren't the only kind of
-- roof this app can now generate: lib/parametric-engine/core/straightSkeletonRoof.ts
-- computes a real roof over an arbitrary drawn footprint (see the Wall
-- Studio). Its output needs to persist through the exact same
-- roof_configs -> parts -> nesting pipeline the rectangular engine already
-- uses, so it needs a distinct roof_type value the existing check
-- constraint didn't allow.
--
-- `params` for a 'polygon' row holds { footprints, pitchDeg, eaveHeightMm,
-- overhangMm } (one footprint per enclosed room) rather than a RoofParams
-- object -- callers must branch on roof_type before interpreting it, the
-- same way the client already branches on RoofParams.type for gable vs hip
-- vs shed.
--
-- Run this AFTER supabase/schema-parametric-engine.sql.

alter table roof_configs drop constraint if exists roof_configs_roof_type_check;
alter table roof_configs add constraint roof_configs_roof_type_check
  check (roof_type in ('gable', 'hip', 'shed', 'polygon'));
