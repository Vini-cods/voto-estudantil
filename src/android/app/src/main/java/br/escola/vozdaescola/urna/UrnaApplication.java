package br.escola.vozdaescola.urna;

import android.app.Application;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** One store and one operation queue for the whole process, including rotations. */
public final class UrnaApplication extends Application {
    private final ExecutorService operations = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "urna-storage");
        thread.setPriority(Thread.NORM_PRIORITY);
        return thread;
    });
    private Future<ElectionStore> initialized;

    @Override public void onCreate() {
        super.onCreate();
        initialized = operations.submit(() -> {
            // Remove only interrupted, explicitly requested export staging files.
            File[] temporary = getCacheDir().listFiles((directory, name) -> name.startsWith("urna-export-") && name.endsWith(".tmp"));
            if (temporary != null) for (File file : temporary) if (file.isFile()) file.delete();
            return new ElectionStore(new File(getFilesDir(), "Dados"));
        });
    }

    public ExecutorService operations() { return operations; }

    /** Call only from a worker thread. A failed open preserves the existing files. */
    public ElectionStore store() throws IOException {
        try {
            return initialized.get();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("A abertura da urna foi interrompida.", error);
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof IOException) throw (IOException) cause;
            throw new IOException("Não foi possível abrir os dados da urna.", cause);
        }
    }
}
