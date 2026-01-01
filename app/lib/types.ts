export type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type IncidentProperties = {
  OBJECTID: number;
  DATE?: number;
  CITY?: string;
  DESCRIPTION?: string;
  [k: string]: unknown;
};

export type IncidentFeature = GeoJSON.Feature<GeoJSON.Point, IncidentProperties>;

export type IncidentFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  IncidentProperties
>;

export type IncidentFilters = {
  startMs?: number;
  endMs?: number;
  city?: string[];
  description?: string[];
  hideRoadTests?: boolean;
};


