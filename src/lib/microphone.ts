/** Comprueba el permiso sin dejar una segunda captura abierta junto a la del SDK. */
export async function requestMicrophone(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}
