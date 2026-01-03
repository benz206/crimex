export type IncidentTypeChoice = {
  value: string;
  label: string;
};

export const INCIDENT_TYPE_CHOICES: IncidentTypeChoice[] = [
  { value: " ARSON", label: "Arson" },
  { value: " ATTEMPT MURDER", label: "Attempt Murder" },
  { value: " BREAK AND ENTER HOUSE", label: "Break and Enter – House" },
  { value: " BREAK AND ENTER OTHER", label: "Break and Enter – Other" },
  { value: " BREAK AND ENTER SCHOOL", label: "Break and Enter – School" },
  { value: " BREAK AND ENTER SHOP", label: "Break and Enter – Shop" },
  {
    value: " DANGEROUS OPERATION - TRAFFIC",
    label: "Dangerous Operation – Traffic",
  },
  { value: " FEDERAL STATS - DRUGS", label: "Federal Stats – Drugs" },
  { value: " HOMICIDE", label: "Homicide" },
  { value: " IMPAIRED DRIVING", label: "Impaired Driving" },
  { value: " MVC - FATALITY", label: "MVC – Fatality" },
  { value: " MVC - HIT & RUN", label: "MVC – Hit & Run" },
  { value: " MVC - PI", label: "MVC – PI" },
  { value: " OFFENSIVE WEAPONS", label: "Offensive Weapons" },
  {
    value: " PROPERTY DAMAGE OVER $5,000",
    label: "Property Damage Over $5,000",
  },
  {
    value: " PROPERTY DAMAGE UNDER $5,000",
    label: "Property Damage Under $5,000",
  },
  {
    value: " RECOVERED VEHICLE OTH SERVICE",
    label: "Recovered Vehicle – Other",
  },
  { value: " ROADSIDE TEST", label: "Roadside Test" },
  { value: " ROBBERY", label: "Robbery" },
  { value: " THEFT FROM AUTO", label: "Theft From Auto" },
  { value: " THEFT OF BICYCLE", label: "Theft of Bicycle" },
  { value: " THEFT OF VEHICLE", label: "Theft of Vehicle" },
  { value: " THEFT OVER", label: "Theft Over $5,000" },
  { value: " THEFT UNDER", label: "Theft Under $5,000" },
];

export const INCIDENT_TYPE_FILTER_OPTIONS: IncidentTypeChoice[] = [
  { value: "", label: "All" },
  ...INCIDENT_TYPE_CHOICES,
];
