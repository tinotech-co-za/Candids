export type Photo = {
  id: string;
  caption: string;
  contributor: string;
  createdAt: number;
  size: number;
  canDelete: boolean;
  url?: string;
};
export type Album = {
  id: string;
  name: string;
  eventDate: string;
  expiresAt: number;
  shared: boolean;
  uploadsOpen: boolean;
  role: "host" | "guest";
  guestName: string;
  photoCount: number;
  remainingUploads: number;
  photos: Photo[];
  members: { id: string; name: string; blocked: boolean }[];
  limits: { photos: number; guests: number; guestPhotos: number };
};
export type Manifest = {
  album: string;
  eventDate: string;
  expiresAt: number;
  photos: {
    id: string;
    filename: string;
    caption: string;
    contributor: string;
    size: number;
    url?: string;
  }[];
};
