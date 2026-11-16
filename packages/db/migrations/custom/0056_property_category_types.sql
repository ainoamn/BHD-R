-- Expand property_category for farms, hotels, and other common listing types.
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'house';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'duplex';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'townhouse';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'penthouse';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'studio';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'chalet';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'palace';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'hotel';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'farm';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'showroom';
ALTER TYPE "property_category" ADD VALUE IF NOT EXISTS 'labor_camp';
