/**
 * Opening what hydra's inputs play: a camera, a screen, a picture, a video.
 * Each comes back as an element hydra can read as a texture, with a way to
 * let go of it again.
 */

export interface OpenInput {
  element: HTMLVideoElement | HTMLImageElement;
  /** It changes over time: hydra reads it again every frame */
  dynamic: boolean;
  /** Called when it stops on its own: a screen share ended from the browser */
  onended?: () => void;
  close: () => void;
}

/** A playing, muted video element for a stream or a file */
function videoElement(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  return video;
}

function whenReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("the video could not be played")), {
      once: true,
    });
  });
}

async function fromStream(stream: MediaStream): Promise<OpenInput> {
  const video = videoElement();
  video.srcObject = stream;
  const input: OpenInput = {
    element: video,
    dynamic: true,
    close: () => {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
  for (const track of stream.getVideoTracks()) {
    track.addEventListener("ended", () => input.onended?.());
  }
  try {
    const ready = whenReady(video);
    await video.play();
    await ready;
  } catch (error) {
    input.close();
    throw error;
  }
  return input;
}

/** The camera at `index` among the cameras the browser lists */
export async function openCamera(index: number): Promise<OpenInput> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const camera = devices.filter((device) => device.kind === "videoinput")[index];
  // Before permission is given the list has no ids: ask for any camera, which also asks permission
  const video = camera?.deviceId ? { deviceId: { exact: camera.deviceId } } : index === 0;
  if (!video) throw new Error(`there is no camera ${index}`);
  return fromStream(await navigator.mediaDevices.getUserMedia({ audio: false, video }));
}

/** Must be called from a click: the browser shows its own picker */
export async function openScreen(): Promise<OpenInput> {
  return fromStream(await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true }));
}

export async function openVideo(file: Blob): Promise<OpenInput> {
  const url = URL.createObjectURL(file);
  const video = videoElement();
  const close = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    const ready = whenReady(video);
    video.src = url;
    await ready;
    // Autoplay can be refused; the first frame still shows
    video.play().catch(() => {});
  } catch (error) {
    close();
    throw error;
  }
  return { element: video, dynamic: true, close };
}

export async function openImage(file: Blob): Promise<OpenInput> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("the picture could not be read");
  }
  return { element: image, dynamic: false, close: () => URL.revokeObjectURL(url) };
}
