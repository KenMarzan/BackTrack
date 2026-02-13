import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { clusterName, apiEndpoint, namespace, token } = await request.json();

    if (!apiEndpoint || !namespace || !token) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify connection first (mocked for testing)
    // In production, replace this with actual Kubernetes API call
    const testSuccess = true;

    if (!testSuccess) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to connect to cluster`,
        },
        { status: 400 },
      );
    }

    // Store connection info in session/cookie for future use
    const response = NextResponse.json({
      success: true,
      message: `Successfully connected to cluster: ${clusterName || namespace}`,
      config: {
        clusterName: clusterName || namespace,
        apiEndpoint,
        namespace,
      },
    });

    // Store in a secure httpOnly cookie
    response.cookies.set(
      "k8s_config",
      JSON.stringify({
        apiEndpoint,
        namespace,
        token,
        clusterName: clusterName || namespace,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60, // 7 days
      },
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      },
      { status: 500 },
    );
  }
}
